const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  OVERDUE_CRON,
  OVERDUE_ELIGIBLE_STATUSES,
  singaporeDateKey,
  isSubscriptionInvoiceOverdue
} = require('../services/subscriptionInvoiceOverdue');

test('daily overdue evaluation uses Singapore time after midnight', () => {
  assert.equal(OVERDUE_CRON, '10 0 * * *');
  assert.equal(singaporeDateKey(new Date('2026-07-28T16:05:00.000Z')), '2026-07-29');
});

test('only delivered unpaid subscription invoice states can become overdue', () => {
  assert.deepEqual(OVERDUE_ELIGIBLE_STATUSES, ['Sent', 'Viewed', 'PendingPayment', 'PaymentFailed']);
  for (const status of OVERDUE_ELIGIBLE_STATUSES) {
    assert.equal(isSubscriptionInvoiceOverdue({ status, dueDate: '2026-07-28' }, '2026-07-29'), true);
  }
  for (const status of ['Draft', 'Approved', 'Paid', 'Rejected', 'Refunded', 'Overdue']) {
    assert.equal(isSubscriptionInvoiceOverdue({ status, dueDate: '2026-07-28' }, '2026-07-29'), false);
  }
});

test('an invoice is not overdue on its due date', () => {
  assert.equal(isSubscriptionInvoiceOverdue({ status: 'Viewed', dueDate: '2026-07-29' }, '2026-07-29'), false);
});

test('overdue automation remains separate from legacy invoices and payments', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionInvoiceOverdue.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment/);
  assert.match(source, /SubscriptionInvoice/);
  assert.match(source, /subscription_invoice_marked_overdue/);
});
