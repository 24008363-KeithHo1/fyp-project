const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePayrollReminders } = require('../services/payrollAutomation');

test('evaluates payroll reminders when deadlines are within the configured lead window', () => {
  const settings = {
    payrollUploadReminderOffsetDays: '2',
    payrollUploadDeadline: '2026-07-09',
    financeApprovalDeadline: '2026-07-11',
    salaryReleaseDate: '2026-07-12'
  };

  const reminders = evaluatePayrollReminders(settings, '2026-07-07');

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].key, 'payrollUploadDeadline');
  assert.equal(reminders[0].daysUntil, 2);
});

test('does not create reminders when deadlines are outside the configured lead window', () => {
  const settings = {
    payrollUploadReminderOffsetDays: '2',
    payrollUploadDeadline: '2026-07-09',
    financeApprovalDeadline: '2026-07-11',
    salaryReleaseDate: '2026-07-12'
  };

  const reminders = evaluatePayrollReminders(settings, '2026-07-03');

  assert.equal(reminders.length, 0);
});
