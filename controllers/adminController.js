const User = require('../models/User');
const { Op } = require('sequelize');
const AuditLog = require('../models/AuditLog');
const ReminderDelivery = require('../models/ReminderDelivery');
const PayrollPeriod = require('../models/PayrollPeriod');
const { reconcileReminderBounces } = require('../services/emailBounceReconciliation');
const { closePayrollPeriod, WORKFLOW, saveActivePayrollPeriod, submitPayrollPeriod } = require('../services/payrollPeriod');
const { sendEmail } = require('../utils/email');
const { logAction } = require('../utils/audit');
const {
  getAutomationSettings,
  saveAutomationSettings,
  runPayrollReminderAutomation,
  evaluatePayrollReminders
} = require('../services/payrollAutomation');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

    if (!Number.isInteger(targetId)) {
      return res.status(400).send('Invalid user id.');
    }

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

    // Existence check before writing — without this, updating a stale or
    // tampered/nonexistent id silently matches zero rows, yet the code
    // would still write an audit log entry and redirect as if it
    // succeeded, giving false confidence that the change actually landed.
    const targetUser = await User.findByPk(targetId);
    if (!targetUser) {
      return res.status(404).send('User not found.');
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
    const reminderPreview = settings.activePeriod ? evaluatePayrollReminders(settings, new Date()) : [];
    res.render('admin/automation', {
      title: 'Payroll Reminder Settings',
      settings,
      workflow: WORKFLOW,
      reminderPreview,
      message: req.query.message || '',
      error: req.query.error || '',
      automationBasePath: '/hr/automation'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.saveAutomationSettings = async (req, res) => {
  try {
    await saveAutomationSettings(req.body);
    const automationBasePath = '/hr/automation';
    res.redirect(`${automationBasePath}?message=Settings updated`);
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
    const counts = result.deliveryCounts;
    const msg = encodeURIComponent(
      `Reminder run completed. ${result.reminders.length} reminder(s) found; ` +
      `${counts.sent} sent, ${counts.duplicate} duplicate(s) skipped, ` +
      `${counts.failed} failed, ${counts.skipped} not sent.`
    );
    const automationBasePath = '/hr/automation';
    res.redirect(`${automationBasePath}?message=${msg}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.savePayrollPeriod = async (req, res) => {
  const automationBasePath = '/hr/automation';
  try {
    await saveActivePayrollPeriod(req.body);
    res.redirect(`${automationBasePath}?message=${encodeURIComponent('Payroll period saved')}`);
  } catch (err) {
    console.error(err);
    res.redirect(`${automationBasePath}?error=${encodeURIComponent(err.message)}`);
  }
};

exports.submitPayrollPeriod = async (req, res) => {
  const automationBasePath = '/hr/automation';
  try {
    const { period, totals } = await submitPayrollPeriod(req.params.id, req.user.id, req.body.notes);
    await logAction(req, 'payroll_submitted_for_approval', 'PayrollPeriod', period.id, totals);

    const financeUsers = await User.findAll({
      where: { isActive: true, role: { [Op.in]: ['Finance'] } }
    });
    let notified = 0;
    let notificationFailures = 0;
    const financeUrl = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}/payroll`;
    for (const user of financeUsers) {
      if (!user.email) continue;
      try {
        const result = await sendEmail(
          user.email,
          `Payroll approval required: ${period.name}`,
          `<h3>Payroll approval required</h3>
           <p><strong>${escapeHtml(period.name)}</strong> has been submitted by HR for Finance approval.</p>
           <ul><li>Employees: ${totals.employeeCount}</li><li>Total gross: SGD ${totals.gross.toFixed(2)}</li><li>Total net: SGD ${totals.net.toFixed(2)}</li></ul>
           <p><a href="${financeUrl}">Review payroll</a></p>`
        );
        if (result && !result.skipped) notified += 1;
        else notificationFailures += 1;
      } catch (emailError) {
        notificationFailures += 1;
        console.error('Finance payroll submission notification failed:', emailError.message);
      }
    }

    const message = `Payroll submitted to Finance. ${totals.employeeCount} employee record(s), ` +
      `${notified} Finance notification(s) sent` +
      (notificationFailures ? `, ${notificationFailures} notification(s) not sent.` : '.');
    res.redirect(`${automationBasePath}?message=${encodeURIComponent(message)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`${automationBasePath}?error=${encodeURIComponent(err.message)}`);
  }
};

exports.closePayrollPeriod = async (req, res) => {
  const automationBasePath = '/hr/automation';
  try {
    const { period, total } = await closePayrollPeriod(req.params.id, req.user.id);
    await logAction(req, 'payroll_period_closed', 'PayrollPeriod', period.id, { employeeCount: total });
    res.redirect(`${automationBasePath}?message=${encodeURIComponent(`${period.name} closed successfully. You can now create the next payroll period.`)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`${automationBasePath}?error=${encodeURIComponent(err.message)}`);
  }
};

exports.reminderHistory = async (req, res) => {
  try {
    let bounceSyncError = '';
    try {
      await reconcileReminderBounces();
    } catch (err) {
      bounceSyncError = 'Could not check the sender mailbox for delivery failures. Verify the IMAP settings.';
      console.error('Reminder bounce reconciliation failed:', err.message);
    }
    const where = {};
    const allowedStatuses = ['sent', 'failed', 'skipped'];
    const allowedReminderKeys = [
      'payrollUploadDeadline',
      'financeApprovalDeadline',
      'salaryReleaseDate'
    ];

    if (allowedStatuses.includes(req.query.status)) where.status = req.query.status;
    if (allowedReminderKeys.includes(req.query.reminderKey)) where.reminderKey = req.query.reminderKey;

    const deliveries = await ReminderDelivery.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: 200
    });
    const periodIds = [...new Set(deliveries.map((delivery) => delivery.payrollPeriodId).filter(Boolean))];
    const periods = periodIds.length ? await PayrollPeriod.findAll({ where: { id: periodIds } }) : [];
    const periodNames = Object.fromEntries(periods.map((period) => [period.id, period.name]));
    const automationBasePath = '/hr/automation';

    res.render('admin/reminder-history', {
      title: 'Payroll Reminder History',
      deliveries,
      periodNames,
      bounceSyncError,
      filters: {
        status: req.query.status || '',
        reminderKey: req.query.reminderKey || ''
      },
      automationBasePath
    });
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
