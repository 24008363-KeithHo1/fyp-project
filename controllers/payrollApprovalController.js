const { Op } = require('sequelize');
const Payroll = require('../models/Payroll');
const PayrollPeriod = require('../models/PayrollPeriod');
const User = require('../models/User');
const { approvePayrollPeriod, rejectPayrollPeriod } = require('../services/payrollPeriod');
const { sendEmail } = require('../utils/email');
const { logAction } = require('../utils/audit');

function deductionTotal(value) {
  if (value == null) return 0;
  if (typeof value === 'number' || typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0);
  return 0;
}

function summarize(records) {
  return records.reduce((summary, record) => ({
    employeeCount: summary.employeeCount + 1,
    paidCount: summary.paidCount + (record.payment_status === 'Paid' ? 1 : 0),
    gross: summary.gross + Number(record.gross || 0),
    deductions: summary.deductions + deductionTotal(record.deductions),
    net: summary.net + Number(record.net || 0)
  }), { employeeCount: 0, paidCount: 0, gross: 0, deductions: 0, net: 0 });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function notifyHr(period, subject, body) {
  const users = await User.findAll({ where: { isActive: true, role: { [Op.in]: ['HR'] } } });
  const results = { sent: 0, failed: 0 };
  for (const user of users) {
    if (!user.email) continue;
    try {
      const result = await sendEmail(user.email, subject, body);
      if (result && !result.skipped) results.sent += 1;
      else results.failed += 1;
    } catch (err) {
      results.failed += 1;
      console.error(`HR payroll decision notification failed for period ${period.id}:`, err.message);
    }
  }
  return results;
}

exports.listPage = async (req, res) => {
  try {
    const periods = await PayrollPeriod.findAll({
      where: {
        [Op.or]: [
          { status: { [Op.in]: ['PendingApproval', 'Approved', 'Released', 'Closed'] } },
          { rejectedAt: { [Op.ne]: null } }
        ]
      },
      order: [['updatedAt', 'DESC']],
      limit: 100
    });
    const ids = periods.map((period) => period.id);
    const records = ids.length ? await Payroll.findAll({ where: { payrollPeriodId: { [Op.in]: ids } } }) : [];
    const summaries = {};
    for (const period of periods) {
      summaries[period.id] = summarize(records.filter((record) => record.payrollPeriodId === period.id));
    }
    res.render('finance/payroll-approvals', {
      title: 'Payroll Approvals', periods, summaries,
      message: req.query.message || '', error: req.query.error || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load payroll approvals');
  }
};

exports.detailPage = async (req, res) => {
  try {
    const period = await PayrollPeriod.findByPk(req.params.id);
    if (!period) return res.status(404).send('Payroll period not found');
    const wasReturnedToHr = period.status === 'PayrollUploaded' && period.rejectedAt;
    if (!['PendingApproval', 'Approved', 'Released', 'Closed'].includes(period.status) && !wasReturnedToHr) {
      return res.status(404).send('Payroll approval not found');
    }
    const records = await Payroll.findAll({ where: { payrollPeriodId: period.id }, order: [['name', 'ASC']] });
    res.render('finance/payroll-approval-detail', {
      title: `Review ${period.name}`, period, records, summary: summarize(records),
      message: req.query.message || '', error: req.query.error || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load payroll approval');
  }
};

exports.approve = async (req, res) => {
  try {
    const { period, recordCount } = await approvePayrollPeriod(req.params.id, req.user.id);
    await logAction(req, 'payroll_period_approved', 'PayrollPeriod', period.id, { recordCount });
    const notifications = await notifyHr(
      period,
      `Payroll approved: ${period.name}`,
      `<h3>Payroll approved</h3><p>Finance approved <strong>${escapeHtml(period.name)}</strong>.</p><p>${recordCount} employee payroll record(s) are now approved for salary release.</p>`
    );
    const message = `Payroll approved. ${recordCount} record(s) updated; ${notifications.sent} HR notification(s) sent.`;
    res.redirect(`/finance/payroll-approvals/${period.id}?message=${encodeURIComponent(message)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/finance/payroll-approvals/${req.params.id}?error=${encodeURIComponent(err.message)}`);
  }
};

exports.reject = async (req, res) => {
  try {
    const period = await rejectPayrollPeriod(req.params.id, req.user.id, req.body.reason);
    await logAction(req, 'payroll_changes_requested', 'PayrollPeriod', period.id, { reason: period.rejectionReason });
    const notifications = await notifyHr(
      period,
      `Payroll changes requested: ${period.name}`,
      `<h3>Payroll changes requested</h3><p>Finance returned <strong>${escapeHtml(period.name)}</strong> to HR.</p><p><strong>Reason:</strong> ${escapeHtml(period.rejectionReason)}</p>`
    );
    const message = `Payroll returned to HR. ${notifications.sent} HR notification(s) sent.`;
    res.redirect(`/finance/payroll-approvals/${period.id}?message=${encodeURIComponent(message)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/finance/payroll-approvals/${req.params.id}?error=${encodeURIComponent(err.message)}`);
  }
};

module.exports.summarize = summarize;
