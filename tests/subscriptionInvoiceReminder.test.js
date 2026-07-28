const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  OVERDUE_REMINDER_MILESTONES,
  daysBetween,
  reminderKeyFor,
  nextReminderMilestone,
  composeOverdueReminder
} = require('../services/subscriptionInvoiceReminder');

function overdueInvoice(overrides = {}) {
  return {
    id: 4,
    number: 'SUB-202607-0004',
    status: 'Overdue',
    publicToken: 'safe-token',
    dueDate: '2026-07-01',
    businessNameSnapshot: 'Customer 4',
    billingEmailSnapshot: 'customer4@example.com',
    totalAmount: 99,
    currency: 'SGD',
    ...overrides
  };
}

test('uses controlled 1, 7 and 14-day overdue milestones', () => {
  assert.deepEqual(OVERDUE_REMINDER_MILESTONES, [1, 7, 14]);
  assert.equal(daysBetween('2026-07-01', '2026-07-08'), 7);
  assert.equal(nextReminderMilestone(overdueInvoice(), [], '2026-07-02'), 1);
  assert.equal(nextReminderMilestone(overdueInvoice(), [], '2026-07-08'), 7);
  assert.equal(nextReminderMilestone(overdueInvoice(), [], '2026-07-20'), 14);
});

test('does not repeat a successfully sent reminder milestone', () => {
  const invoice = overdueInvoice();
  const reminderKey = reminderKeyFor(invoice, 7);
  assert.equal(nextReminderMilestone(invoice, [{ reminderKey, status: 'Sent' }], '2026-07-08'), null);
  assert.equal(nextReminderMilestone(invoice, [{ reminderKey, status: 'Failed' }], '2026-07-08'), 7);
});

test('does not remind paid or tokenless invoices', () => {
  assert.equal(nextReminderMilestone(overdueInvoice({ status: 'Paid' }), [], '2026-07-20'), null);
  assert.equal(nextReminderMilestone(overdueInvoice({ publicToken: null }), [], '2026-07-20'), null);
});

test('composes an escaped reminder with the secure payment link', () => {
  const result = composeOverdueReminder(
    overdueInvoice({ businessNameSnapshot: '<Customer 4>' }),
    'https://example.test/subscription-invoices/view/token',
    7
  );
  assert.match(result.subject, /payment reminder/i);
  assert.match(result.html, /7-day overdue reminder/);
  assert.match(result.html, /https:\/\/example\.test\/subscription-invoices\/view\/token/);
  assert.doesNotMatch(result.html, /<Customer 4>/);
});

test('subscription reminder service remains separate from payroll and legacy invoices', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionInvoiceReminder.js'), 'utf8');
  assert.doesNotMatch(source, /Payroll|ReminderDelivery|models\/Invoice|models\/Payment/);
  assert.match(source, /SubscriptionEmailDelivery/);
});
