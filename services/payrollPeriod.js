const { sequelize } = require('../config/db');
const PayrollPeriod = require('../models/PayrollPeriod');

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

module.exports = { WORKFLOW, advancePayrollPeriod, getActivePayrollPeriod, saveActivePayrollPeriod, validatePeriod };
