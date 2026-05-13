const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

exports.ensureAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'Admin') return res.status(403).send('Forbidden');
  next();
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({ order: [['id', 'ASC']] });
    res.render('admin/users', { users });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.editUserView = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.redirect('/admin/users');
    res.render('admin/edit_user', { user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { role, isActive } = req.body;
    await User.update({ role, isActive: isActive === 'on' }, { where: { id: req.params.id } });
    try {
      await AuditLog.create({
        userId: req.user && req.user.id ? req.user.id : null,
        action: 'update_user',
        entity: 'User',
        entityId: parseInt(req.params.id, 10),
        meta: { role, isActive: isActive === 'on' }
      });
    } catch (logErr) {
      console.error('Audit log failed:', logErr);
    }
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.dashboardView = (req, res) => {
  res.render('admin/dashboard');
};

exports.listInviteTokens = async (req, res) => {
  try {
    const InviteToken = require('../models/InviteToken');
    const tokens = await InviteToken.findAll({ order: [['createdAt','DESC']], limit: 200 });
    const UserModel = require('../models/User');
    const plain = tokens.map(t => t.get ? t.get({ plain: true }) : t);
    for (const t of plain) {
      if (t.inviterId) {
        try { const u = await UserModel.findByPk(t.inviterId); t.inviter = u ? { id: u.id, name: u.name } : null; } catch(e){ t.inviter = null; }
      }
    }
    res.render('admin/invite_tokens', { tokens: plain });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.listPasswordResets = async (req, res) => {
  try {
    const PasswordResetToken = require('../models/PasswordResetToken');
    const tokens = await PasswordResetToken.findAll({ order: [['createdAt','DESC']], limit: 200 });
    const UserModel = require('../models/User');
    const plain = tokens.map(t => t.get ? t.get({ plain: true }) : t);
    for (const t of plain) {
      if (t.userId) {
        try { const u = await UserModel.findByPk(t.userId); t.user = u ? { id: u.id, name: u.name } : null; } catch(e){ t.user = null; }
      }
    }
    res.render('admin/password_resets', { tokens: plain });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};
