const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionInvoiceItem = require('../models/SubscriptionInvoiceItem');

function validInvoice(overrides = {}) {
  return SubscriptionInvoice.build({
    number: 'SUB-202607-0001',
    partnerCustomerId: 1,
    subscriptionPlanId: 1,
    customerCodeSnapshot: 'CUS-0001',
    businessNameSnapshot: 'Customer 1',
    billingEmailSnapshot: 'customer1@example.com',
    planCodeSnapshot: 'STANDARD',
    planNameSnapshot: 'Standard',
    planFeaturesSnapshot: ['Business Listing', 'Appointment Management'],
    subtotal: 99,
    taxAmount: 0,
    totalAmount: 99,
    billingPeriodStart: '2026-07-01',
    billingPeriodEnd: '2026-07-31',
    invoiceDate: '2026-07-31',
    dueDate: '2026-08-14',
    paymentTermsDaysSnapshot: 14,
    ...overrides
  });
}

test('validates a complete immutable subscription invoice snapshot', async () => {
  const invoice = validInvoice();
  await invoice.validate();
  assert.equal(invoice.status, 'Draft');
  assert.equal(invoice.description, 'Monthly Subscription Fee');
});

test('rejects inconsistent invoice totals and dates', async () => {
  await assert.rejects(() => validInvoice({ totalAmount: 98 }).validate(), /subtotal plus tax/);
  await assert.rejects(
    () => validInvoice({ billingPeriodStart: '2026-08-01' }).validate(),
    /Billing period start/
  );
});

test('validates subscription invoice line totals', async () => {
  const item = SubscriptionInvoiceItem.build({
    subscriptionInvoiceId: 1,
    description: 'Standard Monthly Subscription',
    quantity: 1,
    unitPrice: 99,
    lineAmount: 99
  });
  await item.validate();
  await assert.rejects(
    () => SubscriptionInvoiceItem.build({
      subscriptionInvoiceId: 1,
      description: 'Invalid line',
      quantity: 2,
      unitPrice: 99,
      lineAmount: 99
    }).validate(),
    /quantity multiplied by unit price/
  );
});

test('subscription invoice models do not import legacy invoice or payment models', () => {
  for (const file of ['SubscriptionInvoice.js', 'SubscriptionInvoiceItem.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'models', file), 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\/Invoice['"]\)/);
    assert.doesNotMatch(source, /require\(['"]\.\/Payment['"]\)/);
  }
});
