const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const {
  mapPayPalPayoutStatus,
  assertPayableInvoice,
  paypalEmailFor,
  submitSupplierPayout
} = require('../services/supplierPayout');

const root = path.join(__dirname, '..');
const supplierPayoutSource = fs.readFileSync(path.join(root, 'services', 'supplierPayout.js'), 'utf8');
const paymentRoutesSource = fs.readFileSync(path.join(root, 'routes', 'payment.js'), 'utf8');
const paypalServiceSource = fs.readFileSync(path.join(root, 'services', 'paypalService.js'), 'utf8');
const paymentControllerSource = fs.readFileSync(path.join(root, 'controllers', 'paymentController.js'), 'utf8');

function invoice(overrides = {}) {
  return {
    id: 12,
    number: 'INV-001',
    customer_name: 'Sandbox Supplier',
    amount: 25.5,
    currency: 'USD',
    status: 'Approved',
    paypalEmail: 'supplier-personal@example.com',
    data: {},
    update: async function update(changes) {
      Object.assign(this, changes);
      return this;
    },
    ...overrides
  };
}

function mockPayPalFetch(payoutResponse) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/v1/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'mock-token' })
      };
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(payoutResponse)
    };
  };
  return calls;
}

test('successful supplier payout request uses PayPal Payouts endpoint with invoice currency and supplier email', async () => {
  process.env.PAYPAL_MODE = 'sandbox';
  process.env.PAYPAL_CLIENT_ID = 'client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'client-secret';

  const inv = invoice();
  const calls = mockPayPalFetch({
    batch_header: { payout_batch_id: 'PAYOUT-BATCH-1' },
    items: [{ payout_item_id: 'PAYOUT-ITEM-1', transaction_status: 'PENDING' }]
  });

  const originals = {
    invoiceFindByPk: Invoice.findByPk,
    paymentFindOne: Payment.findOne,
    paymentCreate: Payment.create
  };
  Invoice.findByPk = async () => inv;
  Payment.findOne = async () => null;
  Payment.create = async (payload) => ({ id: 9, ...payload });

  try {
    const result = await submitSupplierPayout(inv.id, 3);
    const payoutCall = calls.find((call) => String(call.url).includes('/v1/payments/payouts'));
    assert.ok(payoutCall, 'expected PayPal Payouts API call');
    assert.doesNotMatch(String(payoutCall.url), /\/v2\/checkout\/orders/);
    const body = JSON.parse(payoutCall.options.body);
    assert.equal(body.items[0].recipient_type, 'EMAIL');
    assert.equal(body.items[0].receiver, inv.paypalEmail);
    assert.equal(body.items[0].amount.currency, 'USD');
    assert.equal(body.items[0].amount.value, '25.50');
    assert.equal(result.payment.status, 'Pending');
    assert.equal(result.payout.payoutBatchId, 'PAYOUT-BATCH-1');
  } finally {
    Invoice.findByPk = originals.invoiceFindByPk;
    Payment.findOne = originals.paymentFindOne;
    Payment.create = originals.paymentCreate;
    delete global.fetch;
  }
});

test('pending payout request does not mark invoice paid', async () => {
  const inv = invoice();
  mockPayPalFetch({
    batch_header: { payout_batch_id: 'PAYOUT-BATCH-2' },
    items: [{ payout_item_id: 'PAYOUT-ITEM-2', transaction_status: 'PENDING' }]
  });

  const originals = { invoiceFindByPk: Invoice.findByPk, paymentFindOne: Payment.findOne, paymentCreate: Payment.create };
  Invoice.findByPk = async () => inv;
  Payment.findOne = async () => null;
  Payment.create = async (payload) => ({ id: 10, ...payload });

  try {
    const result = await submitSupplierPayout(inv.id, 3);
    assert.equal(result.payout.status, 'Pending');
    assert.equal(inv.status, 'Approved');
  } finally {
    Invoice.findByPk = originals.invoiceFindByPk;
    Payment.findOne = originals.paymentFindOne;
    Payment.create = originals.paymentCreate;
    delete global.fetch;
  }
});

test('PayPal API failure is surfaced safely without secrets', async () => {
  process.env.PAYPAL_CLIENT_ID = 'client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'client-secret';
  global.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'secret-token' }) };
    }
    return {
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Payouts not enabled for this sandbox app' })
    };
  };

  const originals = { invoiceFindByPk: Invoice.findByPk, paymentFindOne: Payment.findOne };
  Invoice.findByPk = async () => invoice();
  Payment.findOne = async () => null;

  try {
    await assert.rejects(() => submitSupplierPayout(12, 3), /Payouts not enabled/);
  } finally {
    Invoice.findByPk = originals.invoiceFindByPk;
    Payment.findOne = originals.paymentFindOne;
    delete global.fetch;
  }
});

test('supplier payout validation rejects missing email, unapproved invoice, already-paid invoice, invalid amount and duplicate submission', () => {
  assert.throws(() => assertPayableInvoice(invoice({ paypalEmail: '', data: {} })), /PayPal sandbox email/);
  assert.throws(() => assertPayableInvoice(invoice({ status: 'Draft' })), /approved/);
  assert.throws(() => assertPayableInvoice(invoice({ status: 'Paid' })), /already paid/);
  assert.throws(() => assertPayableInvoice(invoice({ amount: 0 })), /greater than zero/);
  assert.match(supplierPayoutSource, /findDuplicatePayout/);
  assert.match(supplierPayoutSource, /already been submitted/);
});

test('PayPal payout statuses map to internal statuses used by the UI', () => {
  assert.equal(mapPayPalPayoutStatus('SUCCESS'), 'Completed');
  assert.equal(mapPayPalPayoutStatus('PENDING'), 'Pending');
  assert.equal(mapPayPalPayoutStatus('PROCESSING'), 'Processing');
  assert.equal(mapPayPalPayoutStatus('FAILED'), 'Failed');
  assert.equal(mapPayPalPayoutStatus('DENIED'), 'Failed');
  assert.equal(mapPayPalPayoutStatus('CANCELED'), 'Cancelled');
  assert.equal(mapPayPalPayoutStatus('UNCLAIMED'), 'Unclaimed');
  assert.equal(mapPayPalPayoutStatus('RETURNED'), 'Returned');
});

test('successful status confirmation settles locally only after PayPal SUCCESS and uses one database transaction', () => {
  assert.match(supplierPayoutSource, /statusResult\.status === 'Completed'/);
  assert.match(supplierPayoutSource, /sequelize\.transaction/);
  assert.match(supplierPayoutSource, /status:\s*'Paid'/);
  assert.match(supplierPayoutSource, /status:\s*'Completed'/);
  assert.match(supplierPayoutSource, /type:\s*'SupplierPayment'/);
});

test('insufficient Test Bank balance fails before local debit or credit', () => {
  assert.match(supplierPayoutSource, /Company Test Bank account has insufficient balance/);
  assert.match(supplierPayoutSource, /Number\(companyAccount\.balance\) < amount/);
});

test('repeated successful status checks cannot move money twice', () => {
  assert.match(supplierPayoutSource, /TestBankTransaction\.findOne\(\{\s*where:\s*\{\s*reference/s);
  assert.match(supplierPayoutSource, /alreadyApplied:\s*true/);
  assert.match(supplierPayoutSource, /PAYPAL-PAYOUT-/);
});

test('database rollback is available when one local settlement update fails', () => {
  assert.match(supplierPayoutSource, /return sequelize\.transaction\(async \(transaction\)/);
  assert.match(supplierPayoutSource, /companyAccount\.update\([\s\S]*\{\s*transaction\s*\}/);
  assert.match(supplierPayoutSource, /supplierAccount\.update\([\s\S]*\{\s*transaction\s*\}/);
  assert.match(supplierPayoutSource, /lockedInvoice\.update\([\s\S]*\{\s*transaction\s*\}/);
});

test('route layer protects supplier payout endpoints with Finance or Admin role', () => {
  assert.match(paymentRoutesSource, /paypal\/payouts\/:id['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
  assert.match(paymentRoutesSource, /paypal\/payouts\/:id\/status['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
});

test('PayPal service uses sandbox base, environment credentials, and avoids token logging', () => {
  assert.match(paypalServiceSource, /https:\/\/api-m\.sandbox\.paypal\.com/);
  assert.match(paypalServiceSource, /PAYPAL_CLIENT_ID/);
  assert.match(paypalServiceSource, /PAYPAL_CLIENT_SECRET/);
  assert.doesNotMatch(paypalServiceSource, /console\.log\(.*access_token/s);
  assert.equal(paypalEmailFor(invoice({ paypalEmail: '', data: { paypalEmail: 'supplier-data@example.com' } })), 'supplier-data@example.com');
});

test('supplier invoices are blocked from the legacy PayPal Checkout endpoint', () => {
  assert.match(paymentControllerSource, /function isSupplierPayoutInvoice/);
  assert.match(paymentControllerSource, /This is a supplier payout invoice/);
  assert.match(paymentControllerSource, /paypalRequest\('\/v2\/checkout\/orders'/);
});
