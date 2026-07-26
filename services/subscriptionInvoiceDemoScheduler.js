const { Op } = require('sequelize');
const SubscriptionDemoSchedule = require('../models/SubscriptionDemoSchedule');
const { runMonthlySubscriptionInvoiceGeneration } = require('./subscriptionInvoiceAutomation');
const { parseBillingPeriod } = require('./subscriptionInvoiceGeneration');
const { logAudit } = require('../utils/audit');

const DEMO_TIMEZONE = 'Asia/Singapore';
const DEMO_POLL_INTERVAL_MS = 5000;

function parseSingaporeScheduleTime(value, now = new Date()) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Choose a valid Singapore date and time.');
  const scheduledFor = new Date(`${match[1]}T${match[2]}:${match[3]}:00+08:00`);
  if (Number.isNaN(scheduledFor.getTime())) throw new Error('Choose a valid Singapore date and time.');
  if (scheduledFor.getTime() < now.getTime() + 3000) {
    throw new Error('Scheduled demo time must be at least a few seconds in the future.');
  }
  if (scheduledFor.getTime() > now.getTime() + (30 * 24 * 60 * 60 * 1000)) {
    throw new Error('Scheduled demo time must be within the next 30 days.');
  }
  return scheduledFor;
}

async function createDemoSchedule({ billingPeriod, singaporeDateTime, createdBy, now = new Date() }) {
  const period = parseBillingPeriod(billingPeriod);
  const scheduledFor = parseSingaporeScheduleTime(singaporeDateTime, now);
  return SubscriptionDemoSchedule.create({
    billingPeriod: period.key,
    scheduledFor,
    timezone: DEMO_TIMEZONE,
    status: 'Scheduled',
    createdBy
  });
}

async function executeDemoSchedule(schedule, runner = runMonthlySubscriptionInvoiceGeneration) {
  const [claimed] = await SubscriptionDemoSchedule.update({
    status: 'Running',
    startedAt: new Date(),
    errorMessage: null
  }, {
    where: { id: schedule.id, status: 'Scheduled' }
  });
  if (!claimed) return { claimed: false };

  const current = await SubscriptionDemoSchedule.findByPk(schedule.id);
  try {
    const outcome = await runner({
      period: current.billingPeriod,
      triggerSource: 'FinanceRecovery',
      triggeredBy: current.createdBy,
      scheduledFor: current.scheduledFor,
      runKey: `demo-subscription-invoices:scheduled:${current.id}`
    });
    await current.update({
      status: 'Completed',
      completedAt: new Date(),
      automationRunId: outcome.run.id,
      data: {
        alreadyProcessed: outcome.alreadyProcessed,
        generated: outcome.result ? outcome.result.generated : 0,
        skipped: outcome.result ? outcome.result.skipped : 0
      }
    });
    await logAudit({
      userId: current.createdBy,
      action: 'subscription_demo_generation_completed',
      entity: 'SubscriptionDemoSchedule',
      entityId: current.id,
      meta: { billingPeriod: current.billingPeriod, automationRunId: outcome.run.id }
    });
    return { claimed: true, schedule: current, outcome };
  } catch (error) {
    await current.update({
      status: 'Failed',
      completedAt: new Date(),
      errorMessage: error.message
    });
    await logAudit({
      userId: current.createdBy,
      action: 'subscription_demo_generation_failed',
      entity: 'SubscriptionDemoSchedule',
      entityId: current.id,
      meta: { billingPeriod: current.billingPeriod, error: error.message }
    });
    return { claimed: true, schedule: current, error };
  }
}

async function executeDueDemoSchedules(now = new Date()) {
  const schedules = await SubscriptionDemoSchedule.findAll({
    where: {
      status: 'Scheduled',
      scheduledFor: { [Op.lte]: now }
    },
    order: [['scheduledFor', 'ASC'], ['id', 'ASC']],
    limit: 20
  });
  return Promise.all(schedules.map((schedule) => executeDemoSchedule(schedule)));
}

function startSubscriptionDemoScheduler() {
  if (process.env.SUBSCRIPTION_DEMO_SCHEDULER_ENABLED === 'false') return null;
  executeDueDemoSchedules().catch((error) => console.error('Subscription demo scheduler failed:', error));
  const timer = setInterval(() => {
    executeDueDemoSchedules().catch((error) => console.error('Subscription demo scheduler failed:', error));
  }, DEMO_POLL_INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log(`Subscription demo scheduler active (every ${DEMO_POLL_INTERVAL_MS / 1000}s, ${DEMO_TIMEZONE})`);
  return timer;
}

module.exports = {
  DEMO_TIMEZONE,
  DEMO_POLL_INTERVAL_MS,
  parseSingaporeScheduleTime,
  createDemoSchedule,
  executeDemoSchedule,
  executeDueDemoSchedules,
  startSubscriptionDemoScheduler
};
