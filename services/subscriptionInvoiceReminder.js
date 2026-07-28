const cron = require('node-cron');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionEmailDelivery = require('../models/SubscriptionEmailDelivery');
const { sendEmail } = require('../utils/email');
const { escapeHtml } = require('./subscriptionInvoiceEmail');
const { singaporeDateKey } = require('./subscriptionInvoiceOverdue');
const { logAudit } = require('../utils/audit');

const OVERDUE_REMINDER_MILESTONES = Object.freeze([1, 7, 14]);
const REMINDER_TIMEZONE = 'Asia/Singapore';
const REMINDER_CRON = process.env.SUBSCRIPTION_REMINDER_CRON || '20 0 * * *';

function daysBetween(dateString, todayString) {
  const start = Date.parse(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  const end = Date.parse(`${String(todayString).slice(0, 10)}T00:00:00.000Z`);
  return Math.floor((end - start) / 86400000);
}

function reminderKeyFor(invoice, milestone) {
  return `overdue:${String(invoice.dueDate).slice(0, 10)}:${milestone}`;
}

function nextReminderMilestone(invoice, deliveries = [], today = singaporeDateKey()) {
  if (!invoice || invoice.status !== 'Overdue' || !invoice.publicToken) return null;
  const daysOverdue = daysBetween(invoice.dueDate, today);
  const completed = new Set(deliveries
    .filter(delivery => ['Sent', 'Delivered'].includes(delivery.status))
    .map(delivery => delivery.reminderKey));
  const milestone = [...OVERDUE_REMINDER_MILESTONES]
    .reverse()
    .find(value => daysOverdue >= value) || null;
  return milestone && !completed.has(reminderKeyFor(invoice, milestone)) ? milestone : null;
}

function composeOverdueReminder(invoice, publicUrl, milestone) {
  const subject = `Payment reminder: subscription invoice ${invoice.number} is overdue`;
  const html = `
    <p>Dear ${escapeHtml(invoice.businessNameSnapshot)},</p>
    <p>This is a reminder that subscription invoice <strong>${escapeHtml(invoice.number)}</strong>
    for <strong>${escapeHtml(invoice.currency)} ${Number(invoice.totalAmount).toFixed(2)}</strong>
    was due on <strong>${escapeHtml(String(invoice.dueDate).slice(0, 10))}</strong>.</p>
    <p>This is the ${milestone}-day overdue reminder.</p>
    <p><a href="${escapeHtml(publicUrl)}">View and pay your invoice securely</a></p>
    <p>If payment has already been completed, please disregard this message.</p>
    <p>Regards,<br>Vaniday Singapore</p>`;
  return { subject, html };
}

async function previewOverdueReminders(today = singaporeDateKey()) {
  const invoices = await SubscriptionInvoice.findAll({
    where: { status: 'Overdue' },
    include: [{
      model: SubscriptionEmailDelivery,
      as: 'emailDeliveries',
      required: false,
      separate: true,
      where: { emailType: 'Reminder' }
    }],
    order: [['dueDate', 'ASC'], ['id', 'ASC']]
  });
  const candidates = invoices.map(invoice => {
    const milestone = nextReminderMilestone(invoice, invoice.emailDeliveries || [], today);
    return milestone ? {
      invoice,
      milestone,
      reminderKey: reminderKeyFor(invoice, milestone),
      daysOverdue: daysBetween(invoice.dueDate, today)
    } : null;
  }).filter(Boolean);
  return { today, count: candidates.length, candidates };
}

async function sendOverdueReminders({
  appUrl,
  triggeredBy,
  sendEmailFn = sendEmail,
  today = singaporeDateKey()
}) {
  const preview = await previewOverdueReminders(today);
  const result = { eligible: preview.count, sent: 0, skipped: 0, failed: 0, deliveries: [] };
  for (const candidate of preview.candidates) {
    const { invoice, milestone, reminderKey } = candidate;
    let delivery = await SubscriptionEmailDelivery.findOne({
      where: { subscriptionInvoiceId: invoice.id, emailType: 'Reminder', reminderKey }
    });
    if (delivery && ['Pending', 'Sent', 'Delivered'].includes(delivery.status)) {
      result.skipped += 1;
      continue;
    }
    const publicUrl = `${appUrl}/subscription-invoices/view/${encodeURIComponent(invoice.publicToken)}`;
    const { subject, html } = composeOverdueReminder(invoice, publicUrl, milestone);
    try {
      if (delivery) {
        await delivery.update({
          recipient: invoice.billingEmailSnapshot,
          subject,
          status: 'Pending',
          attemptedAt: new Date(),
          failedAt: null,
          errorMessage: null,
          triggeredBy
        });
      } else {
        delivery = await SubscriptionEmailDelivery.create({
          subscriptionInvoiceId: invoice.id,
          emailType: 'Reminder',
          reminderKey,
          recipient: invoice.billingEmailSnapshot,
          subject,
          status: 'Pending',
          attemptedAt: new Date(),
          triggeredBy,
          data: { invoiceNumber: invoice.number, milestone }
        });
      }
      const transport = await sendEmailFn(invoice.billingEmailSnapshot, subject, html);
      const skipped = Boolean(transport && transport.skipped);
      await delivery.update({
        status: skipped ? 'Skipped' : 'Sent',
        messageId: transport && transport.messageId ? transport.messageId : null,
        sentAt: skipped ? null : new Date(),
        errorMessage: skipped ? transport.reason || 'Email transport skipped delivery' : null
      });
      result[skipped ? 'skipped' : 'sent'] += 1;
      result.deliveries.push(delivery);
    } catch (error) {
      if (delivery) {
        await delivery.update({ status: 'Failed', failedAt: new Date(), errorMessage: error.message });
      }
      result.failed += 1;
    }
  }
  return result;
}

async function runScheduledOverdueReminders(now = new Date()) {
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const result = await sendOverdueReminders({
    appUrl,
    triggeredBy: null,
    today: singaporeDateKey(now)
  });
  await logAudit({
    userId: null,
    action: 'subscription_overdue_reminder_run_completed',
    entity: 'SubscriptionEmailDelivery',
    entityId: null,
    meta: {
      triggerSource: 'Scheduler',
      eligible: result.eligible,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed
    }
  });
  return result;
}

function startSubscriptionReminderScheduler() {
  if (process.env.SUBSCRIPTION_REMINDER_AUTOMATION_ENABLED === 'false') {
    console.log('Subscription reminder automation disabled');
    return null;
  }
  const task = cron.schedule(REMINDER_CRON, () => {
    runScheduledOverdueReminders().catch((error) => {
      console.error('Subscription reminder scheduler failed:', error);
    });
  }, { timezone: REMINDER_TIMEZONE });
  console.log(`Subscription reminder scheduler active (${REMINDER_CRON}, ${REMINDER_TIMEZONE})`);
  return task;
}

module.exports = {
  OVERDUE_REMINDER_MILESTONES,
  REMINDER_TIMEZONE,
  REMINDER_CRON,
  daysBetween,
  reminderKeyFor,
  nextReminderMilestone,
  composeOverdueReminder,
  previewOverdueReminders,
  sendOverdueReminders,
  runScheduledOverdueReminders,
  startSubscriptionReminderScheduler
};
