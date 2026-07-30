const { sequelize } = require('../config/db');
const PayrollPeriod = require('../models/PayrollPeriod');
const Payroll = require('../models/Payroll');

const WORKFLOW = ['Draft', 'PayrollUploaded', 'PendingApproval', 'Approved', 'Released', 'Closed'];

function validatePeriod(payload = {}) {
  const required = ['name', 'periodStart', 'periodEnd', 'payrollUploadDeadline', 'financeApprovalDeadline', 'salaryReleaseDate'];
  for (const field of required) {
    if (!payload[field]) throw new Error(`${field} is required`);
  }
  const start = new Date(payload.periodStart);
  const end = new Date(payload.periodEnd);
  const upload = new Date(payload.payrollUploadDeadline);
  const approval = new Date(payload.financeApprovalDeadline);
  const release = new Date(payload.salaryReleaseDate);
  if ([start, end, upload, approval, release].some((date) => Number.isNaN(date.getTime()))) {
    throw new Error('All payroll period dates must be valid');
  }
  if (start > end) throw new Error('Period end must be on or after its start');
  if (upload > approval) throw new Error('Finance approval cannot be before the payroll upload deadline');
  if (approval > release) throw new Error('Salary release cannot be before finance approval');
}

async function getActivePayrollPeriod() {
  return PayrollPeriod.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] });
}

function canImportPayroll(period) {
  return Boolean(period && period.isActive && ['Draft', 'PayrollUploaded'].includes(period.status));
}

function requiresCorrectedPayrollUpload(period) {
  if (!period || !period.rejectedAt) return false;
  if (!period.uploadedAt) return true;
  return new Date(period.uploadedAt).getTime() <= new Date(period.rejectedAt).getTime();
}

async function recordPayrollUpload(period, userId, transaction) {
  if (!canImportPayroll(period)) {
    throw new Error('Payroll can only be imported while the active period is Draft or Payroll Uploaded');
  }
  await period.update({
    status: 'PayrollUploaded',
    uploadedBy: userId || null,
    uploadedAt: new Date()
  }, { transaction });
  return period;
}

function validatePayrollRecordsForSubmission(records) {
  if (!records.length) throw new Error('Import at least one payroll record before submitting to Finance');

  const invalid = records.filter((record) => {
    const gross = Number(record.gross);
    const net = Number(record.net);
    return !record.name || !record.email || !record.bank_number ||
      !Number.isFinite(gross) || gross < 0 ||
      !Number.isFinite(net) || net < 0 ||
      record.payment_status !== 'Pending';
  });
  if (invalid.length) {
    throw new Error(`${invalid.length} payroll record(s) have missing payment details, invalid amounts, or an invalid status`);
  }
}

async function submitPayrollPeriod(periodId, userId, notes = '') {
  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!period || !period.isActive) throw new Error('Active payroll period not found');
    if (period.status !== 'PayrollUploaded') {
      throw new Error('Only an uploaded payroll period can be submitted to Finance');
    }
    if (requiresCorrectedPayrollUpload(period)) {
      throw new Error('Upload a corrected payroll file after the Finance change request before resubmitting');
    }

    const records = await Payroll.findAll({
      where: { payrollPeriodId: period.id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    validatePayrollRecordsForSubmission(records);

    await period.update({
      status: 'PendingApproval',
      submittedBy: userId || null,
      submittedAt: new Date(),
      submissionNotes: String(notes || '').trim() || null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null
    }, { transaction });

    const totals = records.reduce((summary, record) => ({
      employeeCount: summary.employeeCount + 1,
      gross: summary.gross + Number(record.gross || 0),
      net: summary.net + Number(record.net || 0)
    }), { employeeCount: 0, gross: 0, net: 0 });

    return { period, totals };
  });
}

async function approvePayrollPeriod(periodId, userId) {
  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!period || !period.isActive) throw new Error('Active payroll period not found');
    if (period.status !== 'PendingApproval') throw new Error('Only a payroll pending Finance approval can be approved');

    const records = await Payroll.findAll({
      where: { payrollPeriodId: period.id }, transaction, lock: transaction.LOCK.UPDATE
    });
    validatePayrollRecordsForSubmission(records);
    await Payroll.update(
      { payment_status: 'Approved' },
      { where: { payrollPeriodId: period.id, payment_status: 'Pending' }, transaction }
    );
    await period.update({
      status: 'Approved', approvedBy: userId || null, approvedAt: new Date(),
      rejectedBy: null, rejectedAt: null, rejectionReason: null
    }, { transaction });
    return { period, recordCount: records.length };
  });
}

async function rejectPayrollPeriod(periodId, userId, reason) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('A reason is required when requesting payroll changes');
  if (cleanReason.length > 2000) throw new Error('The change-request reason must be 2000 characters or fewer');

  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!period || !period.isActive) throw new Error('Active payroll period not found');
    if (period.status !== 'PendingApproval') throw new Error('Only a payroll pending Finance approval can be returned');

    await period.update({
      status: 'PayrollUploaded',
      rejectedBy: userId || null,
      rejectedAt: new Date(),
      rejectionReason: cleanReason,
      approvedBy: null,
      approvedAt: null
    }, { transaction });
    return period;
  });
}

function isPayrollPeriodFullyReleased(status, total, paid) {
  return ['Approved', 'Released'].includes(status) && total > 0 && paid === total;
}

function canClosePayrollPeriod(status, total, paid) {
  return status === 'Released' && total > 0 && paid === total;
}

async function refreshPayrollPeriodReleaseStatus(periodId) {
  if (!periodId) return { released: false, paid: 0, total: 0 };
  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!period) throw new Error('Payroll period not found');
    if (!['Approved', 'Released'].includes(period.status)) {
      throw new Error(`Salaries cannot be released while the payroll period is ${period.status}`);
    }

    const total = await Payroll.count({ where: { payrollPeriodId: period.id }, transaction });
    const paid = await Payroll.count({ where: { payrollPeriodId: period.id, payment_status: 'Paid' }, transaction });
    const released = isPayrollPeriodFullyReleased(period.status, total, paid);
    const transitioned = released && period.status !== 'Released';
    if (transitioned) {
      await period.update({ status: 'Released', releasedAt: new Date() }, { transaction });
    }
    return { period, released, transitioned, paid, total };
  });
}

async function closePayrollPeriod(periodId, userId) {
  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!period || !period.isActive) throw new Error('Active payroll period not found');

    const total = await Payroll.count({ where: { payrollPeriodId: period.id }, transaction });
    const paid = await Payroll.count({ where: { payrollPeriodId: period.id, payment_status: 'Paid' }, transaction });
    if (!canClosePayrollPeriod(period.status, total, paid)) {
      throw new Error('A payroll period can only be closed after every salary has been released');
    }

    await period.update({
      status: 'Closed',
      isActive: false,
      closedBy: userId || null,
      closedAt: new Date()
    }, { transaction });
    return { period, total, paid };
  });
}

async function saveActivePayrollPeriod(payload) {
  validatePeriod(payload);
  return sequelize.transaction(async (transaction) => {
    let period = await PayrollPeriod.findOne({ where: { isActive: true }, transaction, lock: transaction.LOCK.UPDATE });
    const values = {
      name: String(payload.name).trim(),
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      payrollUploadDeadline: payload.payrollUploadDeadline,
      financeApprovalDeadline: payload.financeApprovalDeadline,
      salaryReleaseDate: payload.salaryReleaseDate
    };
    if (period) {
      if (period.status !== 'Draft') throw new Error('Only a Draft payroll period can have its dates changed');
      await period.update(values, { transaction });
    } else {
      period = await PayrollPeriod.create({ ...values, status: 'Draft', isActive: true }, { transaction });
    }
    return period;
  });
}

async function advancePayrollPeriod(periodId) {
  return sequelize.transaction(async (transaction) => {
    const period = await PayrollPeriod.findByPk(periodId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!period || !period.isActive) throw new Error('Active payroll period not found');
    const currentIndex = WORKFLOW.indexOf(period.status);
    if (currentIndex < 0 || currentIndex === WORKFLOW.length - 1) throw new Error('Payroll period is already closed');
    const nextStatus = WORKFLOW[currentIndex + 1];
    await period.update({ status: nextStatus, isActive: nextStatus !== 'Closed' }, { transaction });
    return period;
  });
}

module.exports = {
  WORKFLOW,
  approvePayrollPeriod,
  advancePayrollPeriod,
  canImportPayroll,
  canClosePayrollPeriod,
  closePayrollPeriod,
  getActivePayrollPeriod,
  isPayrollPeriodFullyReleased,
  recordPayrollUpload,
  requiresCorrectedPayrollUpload,
  refreshPayrollPeriodReleaseStatus,
  rejectPayrollPeriod,
  saveActivePayrollPeriod,
  submitPayrollPeriod,
  validatePayrollRecordsForSubmission,
  validatePeriod
};
