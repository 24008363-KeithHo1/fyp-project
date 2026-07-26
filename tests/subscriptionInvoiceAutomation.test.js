const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CRON,
  isLastCalendarDay,
  billingPeriodFor,
  automationRunKey
} = require('../services/subscriptionInvoiceAutomation');
const {
  DEMO_POLL_INTERVAL_MS,
  parseSingaporeScheduleTime
} = require('../services/subscriptionInvoiceDemoScheduler');

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

test('converts a Finance demo time from Singapore time to UTC', () => {
  const now = new Date('2026-07-26T01:00:00.000Z');
  const scheduled = parseSingaporeScheduleTime('2026-07-26T10:30', now);
  assert.equal(scheduled.toISOString(), '2026-07-26T02:30:00.000Z');
  assert.equal(DEMO_POLL_INTERVAL_MS, 5000);
});

test('rejects past or excessively distant Finance demo times', () => {
  const now = new Date('2026-07-26T02:00:00.000Z');
  assert.throws(
    () => parseSingaporeScheduleTime('2026-07-26T09:00', now),
    /future/
  );
  assert.throws(
    () => parseSingaporeScheduleTime('2026-09-30T10:00', now),
    /30 days/
  );
});
