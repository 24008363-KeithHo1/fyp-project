const cron = require('node-cron');
const SubscriptionAutomationRun = require('../models/SubscriptionAutomationRun');
const { generateSubscriptionInvoiceDrafts } = require('./subscriptionInvoiceGeneration');
const { logAudit } = require('../utils/audit');

const DEFAULT_TIMEZONE = process.env.SUBSCRIPTION_INVOICE_TIMEZONE || 'Asia/Singapore';
const DEFAULT_CRON = process.env.SUBSCRIPTION_INVOICE_CRON || '0 0 28-31 * *';

function singaporeDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function isLastCalendarDay(date = new Date()) {
  const { year, month, day } = singaporeDateParts(date);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function billingPeriodFor(date = new Date()) {
  const { year, month } = singaporeDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function automationRunKey(period) {
  return `monthly-subscription-invoices:${period}`;
}

async function runMonthlySubscriptionInvoiceGeneration({
  period = billingPeriodFor(),
  triggerSource = 'Scheduler',
  triggeredBy = null,
  scheduledFor = new Date(),
  runKey: suppliedRunKey = null
} = {}) {
  const runKey = suppliedRunKey || automationRunKey(period);
  const [run, created] = await SubscriptionAutomationRun.findOrCreate({
    where: { runKey },
    defaults: {
      runKey,
      billingPeriod: period,
      triggerSource,
      triggeredBy,
      scheduledFor,
      startedAt: new Date(),
      status: 'Running'
    }
  });

  if (!created && (run.status === 'Success' || run.status === 'Running')) {
    return { alreadyProcessed: true, run };
  }

  await run.update({
    triggerSource,
    triggeredBy,
    scheduledFor,
    startedAt: new Date(),
    completedAt: null,
    status: 'Running',
    errorMessage: null
  });

  try {
    const result = await generateSubscriptionInvoiceDrafts(period);
    const status = result.failed > 0 ? (result.generated > 0 ? 'Partial' : 'Failed') : 'Success';
    await run.update({
      status,
      completedAt: new Date(),
      eligibleCount: result.eligible,
      generatedCount: result.generated,
      skippedCount: result.skipped,
      failedCount: result.failed,
      totalAmount: result.totalAmount,
      currency: 'SGD',
      errorMessage: result.errors.length ? result.errors.map((item) => `${item.customerCode}: ${item.error}`).join('\n') : null,
      data: { invoices: result.invoices, errors: result.errors }
    });
    await logAudit({
      userId: triggeredBy,
      action: 'subscription_invoice_generation_completed',
      entity: 'SubscriptionAutomationRun',
      entityId: run.id,
      meta: { period, triggerSource, status, generated: result.generated, failed: result.failed }
    });
    return { alreadyProcessed: false, run, result };
  } catch (error) {
    await run.update({
      status: 'Failed',
      completedAt: new Date(),
      errorMessage: error.message
    });
    await logAudit({
      userId: triggeredBy,
      action: 'subscription_invoice_generation_failed',
      entity: 'SubscriptionAutomationRun',
      entityId: run.id,
      meta: { period, triggerSource, error: error.message }
    });
    throw error;
  }
}

async function scheduledMonthlyGeneration(now = new Date()) {
  if (!isLastCalendarDay(now)) return { skipped: true, reason: 'Not the last calendar day' };
  return runMonthlySubscriptionInvoiceGeneration({
    period: billingPeriodFor(now),
    triggerSource: 'Scheduler',
    scheduledFor: now
  });
}

function startSubscriptionInvoiceScheduler() {
  if (process.env.SUBSCRIPTION_INVOICE_AUTOMATION_ENABLED === 'false') {
    console.log('Subscription invoice automation disabled');
    return null;
  }
  const task = cron.schedule(DEFAULT_CRON, () => {
    scheduledMonthlyGeneration().catch((error) => {
      console.error('Subscription invoice generation scheduler failed:', error);
    });
  }, { timezone: DEFAULT_TIMEZONE });
  console.log(`Subscription invoice scheduler active (${DEFAULT_CRON}, ${DEFAULT_TIMEZONE})`);
  return task;
}

module.exports = {
  DEFAULT_CRON,
  DEFAULT_TIMEZONE,
  singaporeDateParts,
  isLastCalendarDay,
  billingPeriodFor,
  automationRunKey,
  runMonthlySubscriptionInvoiceGeneration,
  scheduledMonthlyGeneration,
  startSubscriptionInvoiceScheduler
};
