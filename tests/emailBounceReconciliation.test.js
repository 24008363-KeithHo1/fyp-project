const test = require('node:test');
const assert = require('node:assert/strict');
const { findFailedRecipients, isFailureNotice } = require('../services/emailBounceReconciliation');

test('recognizes a Gmail address-not-found notice and its failed recipient', () => {
  const subject = 'Delivery Status Notification (Failure)';
  const body = "Your message wasn't delivered to missing@example.com because the address couldn't be found.";

  assert.equal(isFailureNotice(subject, body), true);
  assert.deepEqual(
    findFailedRecipients(subject, body, ['valid@example.com', 'missing@example.com']),
    ['missing@example.com']
  );
});

test('does not interpret an ordinary email mentioning a recipient as a bounce', () => {
  assert.deepEqual(
    findFailedRecipients('Payroll reminder', 'Reminder for staff@example.com', ['staff@example.com']),
    []
  );
});
