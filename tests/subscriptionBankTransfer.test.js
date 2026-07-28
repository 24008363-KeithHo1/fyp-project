const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateBankTransferInput } = require('../services/subscriptionBankTransfer');

function invoice(overrides = {}) {
  return {
    id: 12,
    number: 'SUB-202607-0012',
    status: 'Sent',
    totalAmount: 99,
    currency: 'SGD',
    ...overrides
  };
}

test('validates an exact manual subscription bank transfer', () => {
  const result = validateBankTransferInput({
    reference: 'FAST-20260729-001',
    amount: '99.00',
    paidAt: '2026-07-29T10:30:00+08:00',
    notes: 'Matched to bank statement'
  }, invoice(), new Date('2026-07-29T04:00:00Z'));
  assert.equal(result.reference, 'FAST-20260729-001');
  assert.equal(result.amount, 99);
  assert.equal(result.currency, 'SGD');
});

test('rejects ineligible invoices, mismatched amounts and future payments', () => {
  const valid = {
    reference: 'FAST-20260729-002',
    amount: 99,
    paidAt: '2026-07-29T10:30:00+08:00'
  };
  assert.throws(
    () => validateBankTransferInput(valid, invoice({ status: 'Draft' }), new Date('2026-07-29T04:00:00Z')),
    /unpaid delivered/
  );
  assert.throws(
    () => validateBankTransferInput({ ...valid, amount: 49 }, invoice(), new Date('2026-07-29T04:00:00Z')),
    /exactly match/
  );
  assert.throws(
    () => validateBankTransferInput({ ...valid, paidAt: '2026-07-30T10:30:00+08:00' }, invoice(), new Date('2026-07-29T04:00:00Z')),
    /future/
  );
});

test('bank transfer implementation remains separate from legacy payment models', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionBankTransfer.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment|paymentController/);
  assert.match(source, /SubscriptionPayment/);
  assert.match(source, /transaction\.LOCK\.UPDATE/);
});
