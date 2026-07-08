const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const {
  getAutomationSettings,
  saveAutomationSettings,
  runPayrollReminderAutomation,
  evaluatePayrollReminders
} = require('../services/payrollAutomation');

exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({ order: [['id', 'ASC']] });
    res.render('admin/users', { users, title: 'Manage Users', currentUserId: req.user.id });
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
    res.render('admin/edit_user', { user, title: 'Edit User', currentUserId: req.user.id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

const VALID_ROLES = ['Admin', 'Finance', 'HR', 'Staff'];

exports.updateUser = async (req, res) => {
  try {
    const { role, isActive } = req.body;
    const targetId = parseInt(req.params.id, 10);
    const newIsActive = isActive === 'on';

    // Validate role against a whitelist instead of letting an invalid
    // ENUM value fail at the DB layer with a generic 500.
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).send(`Invalid role: ${role}`);
    }

    // SECURITY: prevent an Admin from demoting or deactivating their own
    // account, which would otherwise lock them out with no recovery path.
    const isSelf = req.user && req.user.id === targetId;
    if (isSelf) {
      if (role && role !== 'Admin') {
        return res.status(400).send('You cannot change your own role away from Admin.');
      }
      if (!newIsActive) {
        return res.status(400).send('You cannot deactivate your own account.');
      }
    }

    await User.update({ role, isActive: newIsActive }, { where: { id: targetId } });
    try {
      await AuditLog.create({
        userId: req.user && req.user.id ? req.user.id : null,
        action: 'update_user',
        entity: 'User',
        entityId: targetId,
        meta: { role, isActive: newIsActive }
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

exports.dashboardView = async (req, res) => {
  try {
    const Invoice = require('../models/Invoice');

    const [totalUsers, adminCount, financeCount, hrCount, staffCount] = await Promise.all([
      User.count(),
      User.count({ where: { role: 'Admin' } }),
      User.count({ where: { role: 'Finance' } }),
      User.count({ where: { role: 'HR' } }),
      User.count({ where: { role: 'Staff' } })
    ]);

    // Ensure Overdue status is up to date before counting (same lazy
    // transition used by invoiceController on every read).
    const invoices = await Invoice.findAll();
    const now = new Date();
    await Promise.all(invoices.map(async (inv) => {
      if (inv.due_date && new Date(inv.due_date) < now && inv.status !== 'Paid' && inv.status !== 'Overdue') {
        await inv.update({ status: 'Overdue' });
      }
    }));

    const totalInvoices = invoices.length;
    const paidInvoices = invoices.filter((i) => i.status === 'Paid').length;
    const overdueInvoices = invoices.filter((i) => i.status === 'Overdue').length;
    const outstandingAmount = invoices
      .filter((i) => i.status !== 'Paid')
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: {
        totalUsers,
        adminCount,
        financeCount,
        hrCount,
        staffCount,
        totalInvoices,
        paidInvoices,
        overdueInvoices,
        outstandingAmount
      }
    });
  } catch (err) {
    console.error(err);
    res.render('admin/dashboard', { title: 'Admin Dashboard', stats: null });
  }
};

exports.automationPage = async (req, res) => {
  try {
    const settings = await getAutomationSettings();
    const reminderPreview = evaluatePayrollReminders(settings, new Date());
    res.render('admin/automation', {
      title: 'Payroll Reminder Settings',
      settings,
      reminderPreview,
      message: req.query.message || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.saveAutomationSettings = async (req, res) => {
  try {
    await saveAutomationSettings(req.body);
    res.redirect('/admin/automation?message=Settings updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.triggerAutomation = async (req, res) => {
  try {
    const result = await runPayrollReminderAutomation({
      currentDate: new Date(),
      req,
      source: 'manual'
    });
    const msg = encodeURIComponent(`Reminder run completed. ${result.reminders.length} reminder(s) found.`);
    res.redirect(`/admin/automation?message=${msg}`);
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
    
    // Enrich with user details. Batched into a single query instead of one
    // findByPk per log row — with up to 1000 rows per page, doing this in
    // a loop meant up to 1000 sequential DB round-trips just to render one
    // page of the audit log.
    const userIds = [...new Set(plain.map(l => l.userId).filter(Boolean))];
    const users = userIds.length ? await User.findAll({ where: { id: userIds } }) : [];
    const userMap = new Map(users.map(u => [u.id, { id: u.id, name: u.name, email: u.email }]));
    for (const log of plain) {
      log.user = log.userId ? (userMap.get(log.userId) || null) : null;
    }
    
    res.render('admin/audit_logs', {
      logs: plain, 
      title: 'Audit Logs',
      filters: { action, entity, userId, startDate, endDate, limit: Math.min(parseInt(limit, 10) || 200, 1000), offset: parseInt(offset, 10) || 0 }
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
    
    // Enrich with user details (batched — see listAuditLogs for why).
    const userIds = [...new Set(plain.map(l => l.userId).filter(Boolean))];
    const users = userIds.length ? await User.findAll({ where: { id: userIds } }) : [];
    const userMap = new Map(users.map(u => [u.id, { id: u.id, name: u.name, email: u.email }]));
    for (const log of plain) {
      log.user = log.userId ? (userMap.get(log.userId) || null) : null;
    }
    
    res.json({ total: count, logs: plain, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
