const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBillingPeriod,
  addDays,
  invoiceNumberFor,
  snapshotFor
} = require('../services/subscriptionInvoiceGeneration');

function demoCustomer() {
  return {
    id: 7,
    customerCode: 'CUS-0007',
    businessName: 'Customer 7',
    billingEmail: 'customer7@example.com',
    currency: 'SGD',
    paymentTermsDays: 14,
    subscriptionPlan: {
      id: 2,
      code: 'STANDARD',
      name: 'Standard',
      monthlyFee: '99.00',
      currency: 'SGD',
      features: ['Business Listing', 'Appointment Management']
    }
  };
}

test('calculates monthly billing boundaries and the following billing date', () => {
  assert.deepEqual(parseBillingPeriod('2026-07'), {
    key: '2026-07',
    compact: '202607',
    start: '2026-07-01',
    end: '2026-07-31',
    nextBillingDate: '2026-08-31'
  });
  assert.equal(parseBillingPeriod('2028-02').end, '2028-02-29');
  assert.throws(() => parseBillingPeriod('2026-13'), /between 01 and 12/);
});

test('calculates Net 14 due dates across month boundaries', () => {
  assert.equal(addDays('2026-07-31', 14), '2026-08-14');
});

test('creates deterministic subscription invoice numbers', () => {
  assert.equal(invoiceNumberFor(parseBillingPeriod('2026-07'), demoCustomer()), 'SUB-202607-0007');
});

test('builds an immutable plan and customer snapshot', () => {
  const snapshot = snapshotFor(demoCustomer(), parseBillingPeriod('2026-07'));
  assert.equal(snapshot.status, 'Draft');
  assert.equal(snapshot.businessNameSnapshot, 'Customer 7');
  assert.equal(snapshot.planNameSnapshot, 'Standard');
  assert.equal(snapshot.totalAmount, 99);
  assert.equal(snapshot.invoiceDate, '2026-07-31');
  assert.equal(snapshot.dueDate, '2026-08-14');
});
