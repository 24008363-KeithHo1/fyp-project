const test = require('node:test');
const assert = require('node:assert/strict');
const Payroll = require('../models/Payroll');
const {
  WORKFLOW,
  canImportPayroll,
  canClosePayrollPeriod,
  isPayrollPeriodFullyReleased,
  validatePayrollRecordsForSubmission,
  validatePeriod
} = require('../services/payrollPeriod');

const validPeriod = {
  name: 'July 2026 Payroll',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  payrollUploadDeadline: '2026-07-20',
  financeApprovalDeadline: '2026-07-23',
  salaryReleaseDate: '2026-07-25'
};

test('accepts a payroll period with chronological milestone dates', () => {
  assert.doesNotThrow(() => validatePeriod(validPeriod));
});

test('rejects payroll milestones in the wrong order', () => {
  assert.throws(
    () => validatePeriod({ ...validPeriod, financeApprovalDeadline: '2026-07-19' }),
    /Finance approval cannot be before/
  );
});

test('defines the payroll workflow in business order', () => {
  assert.deepEqual(WORKFLOW, ['Draft', 'PayrollUploaded', 'PendingApproval', 'Approved', 'Released', 'Closed']);
});

test('allows payroll imports only during editable workflow stages', () => {
  assert.equal(canImportPayroll({ isActive: true, status: 'Draft' }), true);
  assert.equal(canImportPayroll({ isActive: true, status: 'PayrollUploaded' }), true);
  assert.equal(canImportPayroll({ isActive: true, status: 'PendingApproval' }), false);
  assert.equal(canImportPayroll({ isActive: false, status: 'Draft' }), false);
});

test('requires complete pending payroll records before Finance submission', () => {
  const validRecord = Payroll.build({
    name: 'Employee One', email: 'employee@example.com', bank_number: '123456',
    period: 'July 2026', gross: 3000, net: 2800, payment_status: 'Pending'
  });
  assert.doesNotThrow(() => validatePayrollRecordsForSubmission([validRecord]));
  assert.throws(
    () => validatePayrollRecordsForSubmission([Payroll.build({ ...validRecord.get(), bank_number: '' })]),
    /missing payment details/
  );
  assert.throws(() => validatePayrollRecordsForSubmission([]), /Import at least one/);
});

test('releases a payroll period only after every linked salary is paid', () => {
  assert.equal(isPayrollPeriodFullyReleased('Approved', 3, 2), false);
  assert.equal(isPayrollPeriodFullyReleased('Approved', 3, 3), true);
  assert.equal(isPayrollPeriodFullyReleased('Approved', 0, 0), false);
  assert.equal(isPayrollPeriodFullyReleased('PendingApproval', 3, 3), false);
});

test('closes a payroll period only from Released with every salary paid', () => {
  assert.equal(canClosePayrollPeriod('Released', 3, 3), true);
  assert.equal(canClosePayrollPeriod('Released', 3, 2), false);
  assert.equal(canClosePayrollPeriod('Approved', 3, 3), false);
  assert.equal(canClosePayrollPeriod('Released', 0, 0), false);
});
