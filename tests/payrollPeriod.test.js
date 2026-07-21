const test = require('node:test');
const assert = require('node:assert/strict');
const { WORKFLOW, validatePeriod } = require('../services/payrollPeriod');

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
