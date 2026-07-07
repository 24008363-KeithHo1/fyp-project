const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { jwtSecret, jwtExpiry } = require('../config/config');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');

// Throttle password reset requests to prevent someone from spamming a
// victim's inbox, or brute-force probing which emails are registered.
// 3 requests per 15 minutes per IP.
exports.passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const PROFILE_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
if (!fs.existsSync(PROFILE_UPLOAD_DIR)) fs.mkdirSync(PROFILE_UPLOAD_DIR, { recursive: true });

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROFILE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  }
});

const profileUpload = multer({
  storage: profileStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed')); 
    }
  }
});

exports.profileUploadMiddleware = profileUpload.single('profileImage');
const PasswordResetToken = require('../models/PasswordResetToken');
const { sendEmail, inviteEmailHtml, resetEmailHtml } = require('../utils/email');
const { logAudit, getRequestMetadata } = require('../utils/audit');

const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`;

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    // SECURITY: role is intentionally NOT read from req.body here.
    // Public self-registration must never be able to set an elevated role
    // (e.g. "Admin" or "Finance"). All new self-registered accounts are
    // forced to 'Staff'; role changes can only be made afterwards by an
    // authenticated Admin via adminController.updateUser.
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role: 'Staff', isVerified: false });
    const { ip, userAgent } = getRequestMetadata(req);
    await logAudit({
      userId: null,
      action: 'register',
      entity: 'User',
      entityId: user.id,
      meta: { email, role: user.role },
      ip,
      userAgent
    });
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { ip, userAgent } = getRequestMetadata(req);
    const user = await User.findOne({ where: { email } });
    if (!user) {
      await logAudit({ userId: null, action: 'login_failed', entity: 'User', entityId: null, meta: { reason: 'user_not_found', email }, ip, userAgent });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAudit({ userId: user.id, action: 'login_failed', entity: 'User', entityId: user.id, meta: { reason: 'invalid_password' }, ip, userAgent });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.isActive) {
      await logAudit({ userId: user.id, action: 'login_failed', entity: 'User', entityId: user.id, meta: { reason: 'account_deactivated' }, ip, userAgent });
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an administrator.' });
    }
    // if MFA enabled, return short-lived mfa token
    if (user.mfaEnabled) {
      await logAudit({ userId: user.id, action: 'login_mfa_required', entity: 'User', entityId: user.id, meta: { email }, ip, userAgent });
      const mfaToken = jwt.sign({ id: user.id, mfa: true }, jwtSecret, { expiresIn: '5m' });
      return res.json({ mfaRequired: true, mfaToken });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiry });
    await logAudit({ userId: user.id, action: 'login_success', entity: 'User', entityId: user.id, meta: { email, role: user.role }, ip, userAgent });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.mfaVerify = async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const { ip, userAgent } = getRequestMetadata(req);
    const payload = jwt.verify(mfaToken, jwtSecret);
    if (!payload || !payload.id || !payload.mfa) return res.status(400).json({ error: 'Invalid MFA token' });
    const user = await User.findByPk(payload.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isActive) {
      await logAudit({ userId: user.id, action: 'mfa_verify_failed', entity: 'User', entityId: user.id, meta: { reason: 'account_deactivated' }, ip, userAgent });
      return res.status(403).json({ error: 'This account has been deactivated. Please contact an administrator.' });
    }
    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: 'base32', token: code, window: 1 });
    if (!verified) {
      await logAudit({ userId: user.id, action: 'mfa_verify_failed', entity: 'User', entityId: user.id, meta: { reason: 'invalid_code' }, ip, userAgent });
      return res.status(401).json({ error: 'Invalid code' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiry });
    await logAudit({ userId: user.id, action: 'mfa_verify_success', entity: 'User', entityId: user.id, meta: {}, ip, userAgent });
    res.json({ token });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.mfaSetup = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    const { ip, userAgent } = getRequestMetadata(req);
    const secret = speakeasy.generateSecret({ name: `FYP (${user.email})` });
    // KNOWN LIMITATION: calling this endpoint again before mfaEnable
    // silently overwrites the previous secret, invalidating any
    // already-scanned QR code. Acceptable for current scope since the
    // user simply re-scans the new QR; a production version should
    // either warn on overwrite or store pending/active secrets separately.
    // store secret temporarily on user record (not enabling until verify)
    user.mfaSecret = secret.base32;
    await user.save();
    await logAudit({ userId: user.id, action: 'mfa_setup_initiated', entity: 'User', entityId: user.id, meta: {}, ip, userAgent });
    const qr = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qr });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.mfaEnable = async (req, res) => {
  try {
    const user = req.user;
    const { code } = req.body;
    const { ip, userAgent } = getRequestMetadata(req);
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Invalid code' });
    user.mfaEnabled = true; await user.save();
    await logAudit({ userId: user.id, action: 'mfa_enabled', entity: 'User', entityId: user.id, meta: {}, ip, userAgent });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// Invite token functionality removed — registration is open without invites.

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await PasswordResetToken.create({ token, userId: user.id, expiresAt });
    const link = `${APP_URL}/reset?token=${token}`;
    await sendEmail(email, 'Password reset', resetEmailHtml(link));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.updateProfile = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    // Support both JSON and multipart form submissions (when file is included)
    const { name, email, phone, title, department, address, bio } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const normalizedEmail = (email || '').trim().toLowerCase();
    const existing = await User.findOne({ where: { email: normalizedEmail, id: { [Op.ne]: user.id } } });
    if (existing) return res.status(400).json({ error: 'Email already in use' });

    // If a new file was uploaded via multer, replace the old image
    if (req.file) {
      try {
        if (user.profileImage && user.profileImage.startsWith('/uploads/profiles/')) {
          const oldFile = path.join(__dirname, '..', 'public', user.profileImage.replace('/uploads/', 'uploads/'));
          if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
        }
      } catch (e) { /* ignore unlink errors */ }
      user.profileImage = `/uploads/profiles/${req.file.filename}`;
    }

    user.name = (name || user.name).trim();
    user.email = normalizedEmail;
    user.phone = phone || null;
    user.title = title || null;
    user.department = department || null;
    user.address = address || null;
    user.bio = bio || null;

    await user.save();
    const { ip, userAgent } = getRequestMetadata(req);
    await logAudit({ userId: user.id, action: 'update_profile', entity: 'User', entityId: user.id, meta: { name: user.name, email: user.email }, ip, userAgent });

    res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, title: user.title, department: user.department, address: user.address, bio: user.bio, profileImage: user.profileImage, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const { ip, userAgent } = getRequestMetadata(req);
    const pr = await PasswordResetToken.findOne({ where: { token } });
    if (!pr || pr.used || (pr.expiresAt && new Date() > pr.expiresAt)) return res.status(400).json({ error: 'Invalid or expired token' });
    const user = await User.findByPk(pr.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = await bcrypt.hash(password, 10);
    await user.save();
    pr.used = true; await pr.save();
    await logAudit({ userId: user.id, action: 'password_reset', entity: 'User', entityId: user.id, meta: {}, ip, userAgent });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};
exports.me = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    const role = user.role || 'Staff';
    let dashboard = '/staff/dashboard';
    if (role === 'Admin') dashboard = '/admin/dashboard';
    else if (role === 'Finance') dashboard = '/finance/dashboard';
    else if (role === 'HR') dashboard = '/hr/dashboard';

    res.json({ user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      title: user.title,
      department: user.department,
      address: user.address,
      bio: user.bio,
      profileImage: user.profileImage,
      role
    }, dashboard });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
