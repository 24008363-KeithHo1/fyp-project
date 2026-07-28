const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseReportDates,
  summarizeSubscriptionRevenue,
  csvCell,
  buildSubscriptionRevenueCsv
} = require('../services/subscriptionRevenueReport');

test('calculates gross, refunds and net subscription revenue', () => {
  const summary = summarizeSubscriptionRevenue([
    { status: 'Paid', receivedAmount: 99, refundAmount: null, currency: 'SGD' },
    { status: 'Refunded', receivedAmount: 199, refundAmount: 199, currency: 'SGD' }
  ]);
  assert.deepEqual(summary, {
    transactions: 2,
    paidTransactions: 1,
    refundedTransactions: 1,
    grossReceived: 298,
    refunded: 199,
    netRevenue: 99,
    currency: 'SGD'
  });
});

test('validates report date ranges', () => {
  assert.deepEqual(parseReportDates('2026-07-01', '2026-07-31'), {
    from: '2026-07-01',
    to: '2026-07-31'
  });
  assert.throws(() => parseReportDates('07/01/2026', ''), /YYYY-MM-DD/);
  assert.throws(() => parseReportDates('2026-02-30', ''), /valid YYYY-MM-DD/);
  assert.throws(() => parseReportDates('2026-08-01', '2026-07-31'), /after end date/);
});

test('CSV export escapes formulas and quoted customer data', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), "\"'=SUM(A1:A2)\"");
  const csv = buildSubscriptionRevenueCsv([{
    paidAt: '2026-07-29T03:00:00.000Z',
    provider: 'Stripe',
    status: 'Paid',
    receivedAmount: 99,
    refundAmount: 0,
    currency: 'SGD',
    providerReference: 'pi_test_report',
    subscriptionInvoice: {
      number: 'SUB-1',
      businessNameSnapshot: 'Customer \"One\"'
    }
  }]);
  assert.match(csv, /Customer ""One""/);
  assert.match(csv, /99\.00/);
});

test('subscription revenue report remains separate from legacy report models', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'subscriptionRevenueReport.js'), 'utf8');
  assert.doesNotMatch(source, /models\/Invoice|models\/Payment|reportController/);
});
