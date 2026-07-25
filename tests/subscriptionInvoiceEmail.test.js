const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  composeSubscriptionInvoiceEmail,
  sendSubscriptionInvoiceEmail
} = require('../services/subscriptionInvoiceEmail');

function approvedInvoice(overrides = {}) {
  return {
    id: 1,
    number: 'SUB-202607-0001',
    status: 'Approved',
    businessNameSnapshot: 'Customer 1',
    billingEmailSnapshot: 'customer1@example.com',
    planNameSnapshot: 'Standard',
    planFeaturesSnapshot: ['Business Listing', 'Appointment Management'],
    description: 'Standard Monthly Subscription Fee',
    subtotal: 99,
    taxAmount: 0,
    totalAmount: 99,
    currency: 'SGD',
    billingPeriodStart: '2026-07-01',
    billingPeriodEnd: '2026-07-31',
    invoiceDate: '2026-07-31',
    dueDate: '2026-08-14',
    paymentTermsDaysSnapshot: 14,
    ...overrides
  };
}

function mockDeliveryRepository() {
  const records = [];
  return {
    records,
    async create(values) {
      const record = {
        id: records.length + 1,
        ...values,
        async update(changes) {
          Object.assign(this, changes);
          return this;
        }
      };
      records.push(record);
      return record;
    }
  };
}

test('composes a secure-link invoice email with escaped customer data', () => {
  const result = composeSubscriptionInvoiceEmail(
    approvedInvoice({ businessNameSnapshot: '<Customer 1>' }),
    'https://example.test/subscription-invoice/token'
  );
  assert.match(result.subject, /SUB-202607-0001/);
  assert.match(result.html, /&lt;Customer 1&gt;/);
  assert.match(result.html, /View and pay your invoice securely/);
  assert.doesNotMatch(result.html, /<Customer 1>/);
});

test('sends a PDF attachment and records a Sent delivery', async () => {
  const repository = mockDeliveryRepository();
  let attachment;
  const outcome = await sendSubscriptionInvoiceEmail({
    invoice: approvedInvoice(),
    items: [{
      description: 'Standard Monthly Subscription Fee',
      quantity: 1,
      unitPrice: 99,
      lineAmount: 99
    }],
    publicUrl: 'https://example.test/subscription-invoice/token',
    triggeredBy: 9,
    deliveryModel: repository,
    sendEmailFn: async (to, subject, html, options) => {
      attachment = options.attachments[0];
      return { messageId: 'demo-message', accepted: [to], response: '250 accepted' };
    }
  });
  assert.equal(outcome.delivery.status, 'Sent');
  assert.equal(outcome.delivery.triggeredBy, 9);
  assert.equal(attachment.filename, 'SUB-202607-0001.pdf');
  assert.equal(attachment.content.subarray(0, 4).toString(), '%PDF');
});

test('records a Failed delivery when transport throws', async () => {
  const repository = mockDeliveryRepository();
  await assert.rejects(() => sendSubscriptionInvoiceEmail({
    invoice: approvedInvoice(),
    publicUrl: 'https://example.test/subscription-invoice/token',
    deliveryModel: repository,
    sendEmailFn: async () => { throw new Error('SMTP unavailable'); }
  }), /SMTP unavailable/);
  assert.equal(repository.records[0].status, 'Failed');
  assert.match(repository.records[0].errorMessage, /SMTP unavailable/);
});

test('email service remains separate from legacy invoice models', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionInvoiceEmail.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/models\/Invoice['"]\)/);
  assert.doesNotMatch(source, /require\(['"]\.\.\/models\/Payment['"]\)/);
});
