const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CRON,
  isLastCalendarDay,
  billingPeriodFor,
  automationRunKey
} = require('../services/subscriptionInvoiceAutomation');

test('scheduler is configured for midnight on possible month-end dates', () => {
  assert.equal(DEFAULT_CRON, '0 0 28-31 * *');
});

test('recognizes the last calendar day in Singapore', () => {
  assert.equal(isLastCalendarDay(new Date('2026-07-30T16:00:00.000Z')), true);
  assert.equal(isLastCalendarDay(new Date('2026-07-29T16:00:00.000Z')), false);
  assert.equal(billingPeriodFor(new Date('2026-07-30T16:00:00.000Z')), '2026-07');
});

test('handles leap-year February month end', () => {
  assert.equal(isLastCalendarDay(new Date('2028-02-28T16:00:00.000Z')), true);
  assert.equal(isLastCalendarDay(new Date('2028-02-27T16:00:00.000Z')), false);
});

test('uses one idempotency key per monthly generation period', () => {
  assert.equal(automationRunKey('2026-07'), 'monthly-subscription-invoices:2026-07');
});
