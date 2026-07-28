const cron = require('node-cron');
const { Op } = require('sequelize');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const { assertSubscriptionInvoiceTransition } = require('./subscriptionInvoiceLifecycle');
const { logAudit } = require('../utils/audit');

const OVERDUE_TIMEZONE = 'Asia/Singapore';
const OVERDUE_CRON = process.env.SUBSCRIPTION_OVERDUE_CRON || '10 0 * * *';
const OVERDUE_ELIGIBLE_STATUSES = Object.freeze([
  'Sent',
  'Viewed',
  'PendingPayment',
  'PaymentFailed'
]);

function singaporeDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OVERDUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isSubscriptionInvoiceOverdue(invoice, today = singaporeDateKey()) {
  return Boolean(
    invoice
    && OVERDUE_ELIGIBLE_STATUSES.includes(invoice.status)
    && String(invoice.dueDate || '').slice(0, 10) < today
  );
}

async function previewSubscriptionOverdue(now = new Date()) {
  const today = singaporeDateKey(now);
  const invoices = await SubscriptionInvoice.findAll({
    where: {
      status: { [Op.in]: OVERDUE_ELIGIBLE_STATUSES },
      dueDate: { [Op.lt]: today }
    },
    attributes: ['id', 'number', 'businessNameSnapshot', 'dueDate', 'status', 'totalAmount', 'currency'],
    order: [['dueDate', 'ASC'], ['id', 'ASC']]
  });
  return { today, count: invoices.length, invoices };
}

async function markSubscriptionInvoicesOverdue({ now = new Date(), triggeredBy = null, triggerSource = 'Scheduler' } = {}) {
  const preview = await previewSubscriptionOverdue(now);
  const marked = [];
  for (const candidate of preview.invoices) {
    const invoice = await SubscriptionInvoice.findByPk(candidate.id);
    if (!isSubscriptionInvoiceOverdue(invoice, preview.today)) continue;
    assertSubscriptionInvoiceTransition(invoice.status, 'Overdue');
    const previousStatus = invoice.status;
    await invoice.update({ status: 'Overdue', overdueAt: now });
    marked.push({ id: invoice.id, number: invoice.number, previousStatus });
    await logAudit({
      userId: triggeredBy,
      action: 'subscription_invoice_marked_overdue',
      entity: 'SubscriptionInvoice',
      entityId: invoice.id,
      meta: { number: invoice.number, previousStatus, dueDate: invoice.dueDate, triggerSource }
    });
  }
  return { today: preview.today, evaluated: preview.count, marked };
}

function startSubscriptionOverdueScheduler() {
  if (process.env.SUBSCRIPTION_OVERDUE_AUTOMATION_ENABLED === 'false') {
    console.log('Subscription overdue automation disabled');
    return null;
  }
  const task = cron.schedule(OVERDUE_CRON, () => {
    markSubscriptionInvoicesOverdue().catch((error) => {
      console.error('Subscription overdue scheduler failed:', error);
    });
  }, { timezone: OVERDUE_TIMEZONE });
  console.log(`Subscription overdue scheduler active (${OVERDUE_CRON}, ${OVERDUE_TIMEZONE})`);
  return task;
}

module.exports = {
  OVERDUE_TIMEZONE,
  OVERDUE_CRON,
  OVERDUE_ELIGIBLE_STATUSES,
  singaporeDateKey,
  isSubscriptionInvoiceOverdue,
  previewSubscriptionOverdue,
  markSubscriptionInvoicesOverdue,
  startSubscriptionOverdueScheduler
};
