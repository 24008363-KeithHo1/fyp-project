const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUBSCRIPTION_INVOICE_STATUSES,
  canTransitionSubscriptionInvoice,
  assertSubscriptionInvoiceTransition
} = require('../services/subscriptionInvoiceLifecycle');

test('defines the complete subscription invoice lifecycle', () => {
  assert.deepEqual(SUBSCRIPTION_INVOICE_STATUSES, [
    'Draft', 'Approved', 'Sent', 'Viewed', 'PendingPayment',
    'Paid', 'PaymentFailed', 'Overdue', 'Rejected', 'Refunded'
  ]);
});

test('allows normal approval, delivery and payment transitions', () => {
  assert.equal(canTransitionSubscriptionInvoice('Draft', 'Approved'), true);
  assert.equal(canTransitionSubscriptionInvoice('Approved', 'Sent'), true);
  assert.equal(canTransitionSubscriptionInvoice('Sent', 'Viewed'), true);
  assert.equal(canTransitionSubscriptionInvoice('Viewed', 'PendingPayment'), true);
  assert.equal(canTransitionSubscriptionInvoice('PendingPayment', 'Paid'), true);
  assert.equal(canTransitionSubscriptionInvoice('Paid', 'Refunded'), true);
});

test('public viewing cannot overwrite a final or exceptional status', () => {
  assert.equal(canTransitionSubscriptionInvoice('Paid', 'Viewed'), false);
  assert.equal(canTransitionSubscriptionInvoice('Overdue', 'Viewed'), false);
  assert.equal(canTransitionSubscriptionInvoice('Refunded', 'Viewed'), false);
  assert.throws(
    () => assertSubscriptionInvoiceTransition('Paid', 'Viewed'),
    /Invalid subscription invoice transition/
  );
});

test('supports rejection correction and overdue recovery', () => {
  assert.equal(canTransitionSubscriptionInvoice('Draft', 'Rejected'), true);
  assert.equal(canTransitionSubscriptionInvoice('Rejected', 'Draft'), true);
  assert.equal(canTransitionSubscriptionInvoice('Overdue', 'Paid'), true);
});
