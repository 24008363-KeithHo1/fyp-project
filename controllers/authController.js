const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { jwtSecret, jwtExpiry } = require('../config/config');
const User = require('../models/User');
const InviteToken = require('../models/InviteToken');
const PasswordResetToken = require('../models/PasswordResetToken');
const { sendEmail, inviteEmailHtml, resetEmailHtml } = require('../utils/email');

const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`;

exports.register = async (req, res) => {
  try {
    const { name, email, password, role, inviteToken } = req.body;
    // if inviteToken provided, validate
    if (inviteToken) {
      const it = await InviteToken.findOne({ where: { token: inviteToken, email } });
      if (!it || it.used || (it.expiresAt && new Date() > it.expiresAt)) return res.status(400).json({ error: 'Invalid or expired invite token' });
      it.used = true; await it.save();
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role: role || 'Staff', isVerified: !!inviteToken });
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    // if MFA enabled, return short-lived mfa token
    if (user.mfaEnabled) {
      const mfaToken = jwt.sign({ id: user.id, mfa: true }, jwtSecret, { expiresIn: '5m' });
      return res.json({ mfaRequired: true, mfaToken });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiry });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.mfaVerify = async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const payload = jwt.verify(mfaToken, jwtSecret);
    if (!payload || !payload.id || !payload.mfa) return res.status(400).json({ error: 'Invalid MFA token' });
    const user = await User.findByPk(payload.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(401).json({ error: 'Invalid code' });
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiry });
    res.json({ token });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.mfaSetup = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    const secret = speakeasy.generateSecret({ name: `FYP (${user.email})` });
    // store secret temporarily on user record (not enabling until verify)
    user.mfaSecret = secret.base32;
    await user.save();
    const qr = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qr });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.mfaEnable = async (req, res) => {
  try {
    const user = req.user;
    const { code } = req.body;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Invalid code' });
    user.mfaEnabled = true; await user.save();
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.invite = async (req, res) => {
  try {
    const { email } = req.body;
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    const inv = await InviteToken.create({ token, email, expiresAt, inviterId: req.user && req.user.id });
    const link = `${APP_URL}/register?token=${token}&email=${encodeURIComponent(email)}`;
    await sendEmail(email, 'You are invited', inviteEmailHtml(link));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.verifyInvite = async (req, res) => {
  try {
    const { token } = req.query;
    const it = await InviteToken.findOne({ where: { token } });
    if (!it || it.used || (it.expiresAt && new Date() > it.expiresAt)) return res.status(400).send('Invalid or expired invite');
    res.redirect(`/register?token=${token}&email=${encodeURIComponent(it.email)}`);
  } catch (err) { res.status(400).send(err.message); }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await PasswordResetToken.create({ token, userId: user.id, expiresAt });
    const link = `${APP_URL}/reset.html?token=${token}`;
    await sendEmail(email, 'Password reset', resetEmailHtml(link));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const pr = await PasswordResetToken.findOne({ where: { token } });
    if (!pr || pr.used || (pr.expiresAt && new Date() > pr.expiresAt)) return res.status(400).json({ error: 'Invalid or expired token' });
    const user = await User.findByPk(pr.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = await bcrypt.hash(password, 10);
    await user.save();
    pr.used = true; await pr.save();
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

    res.json({ user: { id: user.id, name: user.name, email: user.email, role }, dashboard });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
