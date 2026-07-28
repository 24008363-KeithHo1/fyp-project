const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  receiptDeliveryKey,
  composePaymentConfirmationEmail,
  sendSubscriptionPaymentConfirmation
} = require('../services/subscriptionPaymentEmail');

function paidRecords() {
  return {
    invoice: {
      id: 3,
      number: 'SUB-202607-0003',
      status: 'Paid',
      businessNameSnapshot: 'Customer 3',
      billingEmailSnapshot: 'customer3@example.com',
      planNameSnapshot: 'Premium',
      currency: 'SGD',
      publicToken: 'safe-token'
    },
    payment: {
      id: 9,
      status: 'Paid',
      provider: 'Stripe',
      currency: 'SGD',
      receivedAmount: 199,
      paidAt: '2026-07-29T03:00:00.000Z',
      providerReference: 'pi_test_confirmation'
    }
  };
}

function deliveryRepository(existing = null) {
  const records = existing ? [existing] : [];
  return {
    records,
    async findOne() { return records[0] || null; },
    async create(values) {
      const record = {
        id: 1,
        ...values,
        async update(changes) { Object.assign(this, changes); return this; }
      };
      records.push(record);
      return record;
    }
  };
}

test('builds a stable duplicate key and escaped payment confirmation', () => {
  const { invoice, payment } = paidRecords();
  assert.equal(receiptDeliveryKey(payment), 'payment:9:paid');
  const message = composePaymentConfirmationEmail(
    { ...invoice, businessNameSnapshot: '<Customer 3>' },
    payment,
    'https://example.test/subscription-invoices/view/token'
  );
  assert.match(message.subject, /Payment received/);
  assert.match(message.html, /receipt is attached/);
  assert.doesNotMatch(message.html, /<Customer 3>/);
});

test('sends one receipt PDF and records the confirmation delivery', async () => {
  const { invoice, payment } = paidRecords();
  const repository = deliveryRepository();
  let attachment;
  const outcome = await sendSubscriptionPaymentConfirmation({
    invoice,
    payment,
    publicUrl: 'https://example.test/subscription-invoices/view/token',
    deliveryModel: repository,
    sendEmailFn: async (to, subject, html, options) => {
      attachment = options.attachments[0];
      return { messageId: 'receipt-message', accepted: [to] };
    }
  });
  assert.equal(outcome.failed, undefined);
  assert.equal(outcome.delivery.status, 'Sent');
  assert.equal(outcome.delivery.emailType, 'Receipt');
  assert.equal(attachment.content.subarray(0, 4).toString(), '%PDF');
});

test('does not repeat an already sent payment confirmation', async () => {
  const { invoice, payment } = paidRecords();
  const existing = {
    id: 2,
    status: 'Sent',
    reminderKey: 'payment:9:paid',
    async update(changes) { Object.assign(this, changes); }
  };
  let sends = 0;
  const outcome = await sendSubscriptionPaymentConfirmation({
    invoice,
    payment,
    publicUrl: 'https://example.test/subscription-invoices/view/token',
    deliveryModel: deliveryRepository(existing),
    sendEmailFn: async () => { sends += 1; }
  });
  assert.equal(outcome.skipped, true);
  assert.equal(sends, 0);
});

test('confirmation email remains separate from legacy payment email behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionPaymentEmail.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment|paymentController/);
  assert.match(source, /SubscriptionEmailDelivery/);
});
