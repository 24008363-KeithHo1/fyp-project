const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  PAYPAL_SANDBOX_BASE,
  validatePayPalCapture
} = require('../services/subscriptionPayPal');

function records(overrides = {}) {
  const invoice = {
    id: 5,
    number: 'SUB-202607-0005',
    status: 'PendingPayment',
    totalAmount: 199,
    currency: 'SGD'
  };
  const payment = {
    id: 8,
    provider: 'PayPal',
    status: 'Pending',
    expectedAmount: 199,
    currency: 'SGD',
    data: { paypalOrderId: 'ORDER-TEST-5' }
  };
  const order = {
    id: 'ORDER-TEST-5',
    status: 'COMPLETED',
    purchase_units: [{
      custom_id: '5',
      invoice_id: 'SUB-202607-0005',
      payments: {
        captures: [{
          id: 'CAPTURE-TEST-5',
          status: 'COMPLETED',
          amount: { value: '199.00', currency_code: 'SGD' },
          create_time: '2026-07-29T05:00:00Z'
        }]
      }
    }]
  };
  return {
    invoice: { ...invoice, ...(overrides.invoice || {}) },
    payment: { ...payment, ...(overrides.payment || {}) },
    order: { ...order, ...(overrides.order || {}) }
  };
}

test('uses only the PayPal sandbox API and validates a completed capture', () => {
  assert.equal(PAYPAL_SANDBOX_BASE, 'https://api-m.sandbox.paypal.com');
  const capture = validatePayPalCapture(records());
  assert.equal(capture.id, 'CAPTURE-TEST-5');
});

test('rejects PayPal reference, amount, currency and status mismatches', () => {
  let values = records();
  values.order.purchase_units[0].custom_id = '999';
  assert.throws(() => validatePayPalCapture(values), /references/);

  values = records();
  values.order.purchase_units[0].payments.captures[0].amount.value = '99.00';
  assert.throws(() => validatePayPalCapture(values), /amount/);

  values = records();
  values.order.purchase_units[0].payments.captures[0].amount.currency_code = 'USD';
  assert.throws(() => validatePayPalCapture(values), /currency/);

  values = records();
  values.order.status = 'APPROVED';
  assert.throws(() => validatePayPalCapture(values), /not confirmed/);
});

test('subscription PayPal service remains separate from legacy payment code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionPayPal.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment|controllers\/paymentController/);
  assert.match(source, /SubscriptionPayment/);
  assert.match(source, /transaction\.LOCK\.UPDATE/);
});
