const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  cents,
  validateStripeSettlement
} = require('../services/subscriptionPayment');

function settlement(overrides = {}) {
  const invoice = { id: 8, totalAmount: 99, currency: 'SGD' };
  const payment = { id: 14, subscriptionInvoiceId: 8, expectedAmount: 99, currency: 'SGD' };
  const session = {
    id: 'cs_test_subscription',
    payment_status: 'paid',
    status: 'complete',
    amount_total: 9900,
    currency: 'sgd',
    metadata: {
      module: 'subscription_invoice',
      subscriptionInvoiceId: '8',
      subscriptionPaymentId: '14'
    }
  };
  return {
    invoice: { ...invoice, ...(overrides.invoice || {}) },
    payment: { ...payment, ...(overrides.payment || {}) },
    session: { ...session, ...(overrides.session || {}) }
  };
}

test('validates a paid Stripe sandbox settlement against invoice metadata, amount and currency', () => {
  assert.equal(cents(99), 9900);
  assert.doesNotThrow(() => validateStripeSettlement(settlement()));
});

test('rejects unpaid, mismatched, or legacy Stripe sessions', () => {
  assert.throws(
    () => validateStripeSettlement(settlement({ session: { payment_status: 'unpaid' } })),
    /not confirmed/
  );
  assert.throws(
    () => validateStripeSettlement(settlement({ session: { amount_total: 4900 } })),
    /amount/
  );
  assert.throws(
    () => validateStripeSettlement(settlement({ session: {
      metadata: { module: 'legacy_invoice', subscriptionInvoiceId: '8', subscriptionPaymentId: '14' }
    } })),
    /does not belong/
  );
});

test('subscription payment implementation remains separate from legacy models and routes', () => {
  const root = path.join(__dirname, '..');
  const model = fs.readFileSync(path.join(root, 'models', 'SubscriptionPayment.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionPaymentController.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionPayments.js'), 'utf8');
  assert.doesNotMatch(model, /require\(['"]\.\/Invoice|require\(['"]\.\/Payment/);
  assert.doesNotMatch(controller, /models\/Invoice|models\/Payment/);
  assert.match(controller, /module:\s*'subscription_invoice'/);
  assert.match(controller, /sk_test_/);
  assert.match(controller, /constructEvent/);
  assert.match(routes, /stripe-checkout/);
});
