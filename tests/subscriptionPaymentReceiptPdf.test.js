const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  displayTimestamp,
  generateSubscriptionPaymentReceiptPDF
} = require('../utils/subscriptionPaymentReceiptPdf');

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

test('formats subscription payment receipt timestamps in Singapore time', () => {
  assert.match(displayTimestamp('2026-07-29T02:30:00.000Z'), /29 Jul 2026/);
});

test('generates a valid paid subscription receipt PDF', async () => {
  const invoice = {
    number: 'SUB-202607-0001',
    businessNameSnapshot: 'Customer 1',
    planNameSnapshot: 'Standard',
    currency: 'SGD'
  };
  const payment = {
    provider: 'Stripe',
    status: 'Paid',
    receivedAmount: 99,
    currency: 'SGD',
    paidAt: '2026-07-29T02:30:00.000Z',
    providerReference: 'pi_test_receipt'
  };
  const buffer = await collect(generateSubscriptionPaymentReceiptPDF(invoice, payment));
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(buffer.length > 1000);
});

test('receipt PDF remains separate from legacy receipt and invoice utilities', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'subscriptionPaymentReceiptPdf.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment|invoiceController|paymentController/);
});
