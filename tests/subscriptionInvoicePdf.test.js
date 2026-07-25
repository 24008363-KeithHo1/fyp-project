const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateSubscriptionInvoicePDF, displayDate, money } = require('../utils/subscriptionInvoicePdf');

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

test('formats subscription invoice dates and money consistently', () => {
  assert.equal(displayDate('2026-07-31'), '31 Jul 2026');
  assert.equal(money(99, 'SGD'), 'SGD 99.00');
});

test('generates a valid standalone subscription invoice PDF', async () => {
  const invoice = {
    number: 'SUB-202607-0001',
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
    paymentTermsDaysSnapshot: 14
  };
  const buffer = await collect(generateSubscriptionInvoicePDF(invoice, [{
    description: invoice.description,
    quantity: 1,
    unitPrice: 99,
    lineAmount: 99
  }]));
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(buffer.length > 1000);
});

test('subscription PDF implementation does not import the legacy PDF utility', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'subscriptionInvoicePdf.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/pdf['"]\)/);
  assert.doesNotMatch(source, /generateInvoicePDF/);
});
