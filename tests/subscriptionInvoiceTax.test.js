const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateTaxFromRate,
  taxRateForInvoice
} = require('../services/subscriptionInvoiceTax');

test('calculates invoice tax and total from a percentage rate', () => {
  assert.deepEqual(calculateTaxFromRate(199, 9), {
    subtotal: 199,
    taxRate: 9,
    taxAmount: 17.91,
    totalAmount: 216.91
  });
});

test('rounds percentage tax to currency precision', () => {
  assert.deepEqual(calculateTaxFromRate(99.99, 8.25), {
    subtotal: 99.99,
    taxRate: 8.25,
    taxAmount: 8.25,
    totalAmount: 108.24
  });
});

test('rejects invalid tax percentages', () => {
  assert.throws(() => calculateTaxFromRate(100, -1), /between 0 and 100/);
  assert.throws(() => calculateTaxFromRate(100, 101), /between 0 and 100/);
});

test('uses a stored rate or derives it for older invoices', () => {
  assert.equal(taxRateForInvoice({ subtotal: 200, taxAmount: 18, data: { taxRate: 7 } }), 7);
  assert.equal(taxRateForInvoice({ subtotal: 200, taxAmount: 18, data: {} }), 9);
});
