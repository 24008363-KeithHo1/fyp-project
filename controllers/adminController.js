const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

exports.ensureAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'Admin') return res.status(403).send('Forbidden');
  next();
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({ order: [['id', 'ASC']] });
    res.render('admin/users', { users, title: 'Manage Users' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.listUsersByDepartment = async (req, res) => {
  try {
    const users = await User.findAll({ order: [['role', 'ASC'], ['department', 'ASC'], ['name', 'ASC']] });
    const grouped = {};

    users.forEach((user) => {
      const role = user.role && user.role.trim().length ? user.role.trim() : 'Staff';
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(user);
    });

    const categories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
    res.render('hr/employees', { title: 'Employees by Role', categories, grouped });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.editUserView = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.redirect('/admin/users');
    res.render('admin/edit_user', { user, title: 'Edit User' });
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
  res.render('admin/dashboard', { title: 'Admin Dashboard' });
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
    res.render('admin/password_resets', { tokens: plain, title: 'Password Resets' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.listAuditLogs = async (req, res) => {
  try {
    const { action, entity, userId, startDate, endDate, limit = 200, offset = 0 } = req.query;
    const where = {};
    
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (userId) where.userId = parseInt(userId, 10);
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[require('sequelize').Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[require('sequelize').Op.lte] = new Date(endDate);
    }
    
    const logs = await AuditLog.findAll({ 
      where, 
      order: [['createdAt', 'DESC']], 
      limit: Math.min(parseInt(limit, 10) || 200, 1000),
      offset: parseInt(offset, 10) || 0
    });
    
    const plain = logs.map(l => l.get ? l.get({ plain: true }) : l);
    
    // Enrich with user details
    for (const log of plain) {
      if (log.userId) {
        try {
          const user = await User.findByPk(log.userId);
          log.user = user ? { id: user.id, name: user.name, email: user.email } : null;
        } catch(e) {
          log.user = null;
        }
      }
    }
    
    res.render('admin/audit_logs', { 
      logs: plain, 
      title: 'Audit Logs',
      filters: { action, entity, userId, startDate, endDate }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.listAuditLogsJson = async (req, res) => {
  try {
    const { action, entity, userId, startDate, endDate, limit = 200, offset = 0 } = req.query;
    const where = {};
    
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (userId) where.userId = parseInt(userId, 10);
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[require('sequelize').Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[require('sequelize').Op.lte] = new Date(endDate);
    }
    
    const { count, rows } = await AuditLog.findAndCountAll({ 
      where, 
      order: [['createdAt', 'DESC']], 
      limit: Math.min(parseInt(limit, 10) || 200, 1000),
      offset: parseInt(offset, 10) || 0
    });
    
    const plain = rows.map(l => l.get ? l.get({ plain: true }) : l);
    
    // Enrich with user details
    for (const log of plain) {
      if (log.userId) {
        try {
          const user = await User.findByPk(log.userId);
          log.user = user ? { id: user.id, name: user.name, email: user.email } : null;
        } catch(e) {
          log.user = null;
        }
      }
    }
    
    res.json({ total: count, logs: plain, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
