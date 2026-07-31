const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const PaymentReturn = require('../models/PaymentReturn');
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
const paymentReturnEmailSource = fs.readFileSync(path.join(root, 'services', 'paymentReturnEmail.js'), 'utf8');
const invoiceViewSource = fs.readFileSync(path.join(root, 'views', 'invoice.ejs'), 'utf8');
const financePaymentsViewSource = fs.readFileSync(path.join(root, 'views', 'finance', 'payments.ejs'), 'utf8');

function invoice(overrides = {}) {
  return {
    id: 12,
    number: 'INV-001',
    customer_name: 'Sandbox Supplier',
    amount: 25.5,
    currency: 'USD',
    status: 'Approved',
    paypalEmail: 'supplier-personal@example.com',
    data: { isSupplierInvoice: true },
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
  assert.throws(() => assertPayableInvoice(invoice({ paypalEmail: '', data: { isSupplierInvoice: true } })), /PayPal sandbox email/);
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
  assert.match(paymentRoutesSource, /paypal\/payouts\/:id\/return-request['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
  assert.match(paymentRoutesSource, /returns\/payment\/:id\/request['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
  assert.match(paymentRoutesSource, /returns\/:id\/resend-email['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
  assert.match(paymentRoutesSource, /returns\/:id\/confirm['"], auth, checkRole\(\['Admin', 'Finance'\]\)/);
});

test('PayPal service uses sandbox base, environment credentials, and avoids token logging', () => {
  assert.match(paypalServiceSource, /https:\/\/api-m\.sandbox\.paypal\.com/);
  assert.match(paypalServiceSource, /PAYPAL_CLIENT_ID/);
  assert.match(paypalServiceSource, /PAYPAL_CLIENT_SECRET/);
  assert.doesNotMatch(paypalServiceSource, /console\.log\(.*access_token/s);
  assert.equal(paypalEmailFor(invoice({ paypalEmail: '', data: { paypalEmail: 'supplier-data@example.com' } })), 'supplier-data@example.com');
});

test('payment return workflow separates request, original payment, and confirmed Test Bank return', () => {
  assert.match(supplierPayoutSource, /PaymentReturn\.create\(\{/);
  assert.match(supplierPayoutSource, /originalPaymentId:\s*payment\.id/);
  assert.match(supplierPayoutSource, /status:\s*'ReturnRequested'/);
  assert.match(supplierPayoutSource, /type:\s*'PaymentReturn'/);
  assert.match(supplierPayoutSource, /fromAccountId:\s*supplierAccount\.id/);
  assert.match(supplierPayoutSource, /toAccountId:\s*companyAccount\.id/);
  assert.match(supplierPayoutSource, /status:\s*'Returned'/);
  assert.doesNotMatch(supplierPayoutSource, /lockedPayment\.update\([\s\S]*status:\s*'Refunded'/);
});

test('completed supplier payout return is requested before any Test Bank balance movement', () => {
  const requestIndex = supplierPayoutSource.indexOf('async function requestPaymentReturn');
  const confirmIndex = supplierPayoutSource.indexOf('async function confirmFundsReturned');
  assert.ok(requestIndex > -1);
  assert.ok(confirmIndex > -1);
  const requestBlock = supplierPayoutSource.slice(requestIndex, confirmIndex);
  assert.match(requestBlock, /PaymentReturn\.create/);
  assert.doesNotMatch(requestBlock, /companyAccount\.update|supplierAccount\.update|TestBankTransaction\.create/);
});

test('duplicate payment return requests are blocked by model and service', () => {
  assert.ok(PaymentReturn.rawAttributes.originalPaymentId);
  assert.match(supplierPayoutSource, /PaymentReturn\.findOne\(\{\s*where:\s*\{\s*originalPaymentId:\s*payment\.id\s*\}/);
  assert.match(supplierPayoutSource, /already exists for this supplier payout/);
  assert.match(fs.readFileSync(path.join(root, 'models', 'PaymentReturn.js'), 'utf8'), /unique:\s*true/);
});

test('payment return request validates email and required reason server-side', () => {
  assert.match(supplierPayoutSource, /Enter a valid supplier email address/);
  assert.match(supplierPayoutSource, /validateSupplierEmail/);
  assert.match(supplierPayoutSource, /EMAIL_RE\.test\(supplierEmail\)/);
  assert.match(supplierPayoutSource, /Enter a payment return reason of at least 3 characters/);
});

test('payment return request saves notification fields and sends Nodemailer email', () => {
  assert.ok(PaymentReturn.rawAttributes.supplierEmail);
  assert.ok(PaymentReturn.rawAttributes.notificationEmail);
  assert.ok(PaymentReturn.rawAttributes.notificationStatus);
  assert.ok(PaymentReturn.rawAttributes.notificationSentAt);
  assert.ok(PaymentReturn.rawAttributes.notificationError);
  assert.match(supplierPayoutSource, /sendPaymentReturnRequestEmail\(\{/);
  assert.match(supplierPayoutSource, /notificationStatus:\s*'Sent'/);
  assert.match(supplierPayoutSource, /notificationStatus:\s*'Failed'/);
  assert.match(paymentReturnEmailSource, /sendEmail\(to, email\.subject, email\.html, \{\s*text:\s*email\.text\s*\}\)/);
  assert.match(paymentReturnEmailSource, /text:\s*email\.text/);
  assert.match(paymentReturnEmailSource, /Payment Return Request \\u2013 Invoice/);
  assert.match(supplierPayoutSource, /notificationDelivery/);
  assert.match(supplierPayoutSource, /messageId:\s*emailResult && emailResult\.messageId/);
});

test('payment return email uses requested finance copy without hard-coded SMTP password', () => {
  assert.match(paymentReturnEmailSource, /Dear Supplier/);
  assert.match(paymentReturnEmailSource, /Invoice Number:/);
  assert.match(paymentReturnEmailSource, /Please return the funds using the agreed payment method/);
  assert.match(paymentReturnEmailSource, /Finance Department/);
  assert.doesNotMatch(paymentReturnEmailSource, /password\s*[:=]\s*['"][^'"]+['"]/i);
});

test('failed payment return email keeps the request and enables resend', () => {
  assert.match(supplierPayoutSource, /catch \(emailError\)/);
  assert.match(supplierPayoutSource, /Payment return request was created, but email delivery failed/);
  assert.doesNotMatch(supplierPayoutSource, /throw emailError/);
  assert.match(supplierPayoutSource, /async function resendPaymentReturnEmail/);
  assert.match(supplierPayoutSource, /notificationStatus !== 'Failed'/);
  assert.match(financePaymentsViewSource, /Resend Email/);
  assert.match(financePaymentsViewSource, /\/payment\/returns\/\$\{returnId\}\/resend-email/);
});

test('finance payment return UI uses prompts instead of inline modal markup', () => {
  assert.doesNotMatch(financePaymentsViewSource, /id="paymentReturnRequestModal"/);
  assert.doesNotMatch(financePaymentsViewSource, /id="paypalPayoutConfirmModal"/);
  assert.match(financePaymentsViewSource, /prompt\('Supplier email address'/);
  assert.match(financePaymentsViewSource, /prompt\('Reason for requesting payment return'/);
  assert.match(financePaymentsViewSource, /prompt\('Optional remarks'/);
  assert.match(invoiceViewSource, /id="paymentReturnRequestModal"/);
  assert.match(invoiceViewSource, /openPaymentReturnModal/);
});

test('unclaimed PayPal payouts use payout item cancel endpoint before local status update', () => {
  assert.match(paypalServiceSource, /payouts-item\/\$\{encodeURIComponent\(payoutItemId\)\}\/cancel/);
  assert.match(supplierPayoutSource, /statusResult\.status === 'Unclaimed'/);
  assert.match(supplierPayoutSource, /cancelUnclaimedPayoutItem\(updatedPayout\.payoutItemId\)/);
});

test('supplier return UI uses request and confirmation wording, not immediate reversal wording', () => {
  assert.match(invoiceViewSource, /Request Payment Return/);
  assert.match(financePaymentsViewSource, /Confirm Funds Returned/);
  assert.match(financePaymentsViewSource, /not a PayPal action/);
  assert.match(paymentControllerSource, /Use Request Payment Return for completed supplier PayPal payouts/);
});

test('supplier invoices are blocked from the legacy PayPal Checkout endpoint', () => {
  assert.match(paymentControllerSource, /function isSupplierPayoutInvoice/);
  assert.match(paymentControllerSource, /This is a supplier payout invoice/);
  assert.match(paymentControllerSource, /paypalRequest\('\/v2\/checkout\/orders'/);
});

test('customer invoices keep Stripe and NETS unless explicitly marked as supplier invoices', () => {
  assert.match(invoiceViewSource, /id="isSupplierInvoice"/);
  assert.match(invoiceViewSource, /isSupplierInvoice:\s*document\.getElementById\('isSupplierInvoice'\)\.checked/);
  assert.match(invoiceViewSource, /const isSupplierPayoutInvoice = Boolean\(\(i\.data && i\.data\.isSupplierInvoice\) \|\| supplierPayout\)/);
  assert.doesNotMatch(invoiceViewSource, /const isSupplierPayoutInvoice = i\.status === 'Approved'/);
  assert.match(financePaymentsViewSource, /selectId === 'paypalInvoiceId'\) return Boolean\(inv\.data && inv\.data\.isSupplierInvoice\)/);
  assert.match(supplierPayoutSource, /Mark this invoice as a supplier invoice before sending a supplier payout/);
});

test('payment history hides delete and prompts before request payment return', () => {
  assert.doesNotMatch(financePaymentsViewSource, /delete-payment-btn/);
  assert.doesNotMatch(financePaymentsViewSource, /Delete supplier payment history/);
  assert.match(financePaymentsViewSource, /prompt\('Supplier email address'/);
  assert.match(financePaymentsViewSource, /prompt\('Reason for requesting payment return'/);
  assert.match(financePaymentsViewSource, /body:\s*JSON\.stringify\(\{\s*supplierEmail:\s*supplierEmail\.trim\(\),\s*reason:\s*reason\.trim\(\)\s*\}\)/);
  assert.match(financePaymentsViewSource, /\/payment\/returns\/payment\/\$\{paymentId\}\/request/);
  assert.doesNotMatch(financePaymentsViewSource, /\/payment\/\$\{paymentId\}\/refund/);
  assert.match(supplierPayoutSource, /async function requestPaymentReturnForPayment/);
  assert.match(supplierPayoutSource, /sendPaymentReturnRequestEmail\(\{/);
  assert.match(supplierPayoutSource, /no original payment, invoice, or Test Bank balances modified/);
});
