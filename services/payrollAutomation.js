const cron = require('node-cron');
const AutomationSetting = require('../models/AutomationSetting');
const ReminderDelivery = require('../models/ReminderDelivery');
const User = require('../models/User');
const { sendEmail } = require('../utils/email');
const { logAction, logAudit } = require('../utils/audit');
const { getActivePayrollPeriod } = require('./payrollPeriod');

const DEFAULT_SETTINGS = {
  payrollUploadReminderOffsetDays: '2',
  payrollUploadDeadline: '',
  financeApprovalDeadline: '',
  salaryReleaseDate: ''
};

function toDateOnly(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

async function getAutomationSettings() {
  const rows = await AutomationSetting.findAll();
  const settings = {};
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  const activePeriod = await getActivePayrollPeriod();
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (activePeriod) {
    merged.payrollUploadDeadline = activePeriod.payrollUploadDeadline;
    merged.financeApprovalDeadline = activePeriod.financeApprovalDeadline;
    merged.salaryReleaseDate = activePeriod.salaryReleaseDate;
  }
  return { ...merged, activePeriod };
}

async function saveAutomationSettings(payload = {}) {
  const allowedKeys = ['payrollUploadReminderOffsetDays'];
  for (const key of allowedKeys) {
    if (payload[key] !== undefined) {
      await AutomationSetting.upsert({
        key,
        value: payload[key] == null ? '' : String(payload[key])
      });
    }
  }
  return getAutomationSettings();
}

function evaluatePayrollReminders(settings = {}, currentDate = new Date()) {
  const current = toDateOnly(currentDate);
  const leadDays = normalizeInt(settings.payrollUploadReminderOffsetDays, 2);
  const reminders = [];

  const deadlineEntries = [
    {
      key: 'payrollUploadDeadline',
      label: 'Payroll upload deadline',
      value: settings.payrollUploadDeadline
    },
    {
      key: 'financeApprovalDeadline',
      label: 'Finance approval deadline',
      value: settings.financeApprovalDeadline
    },
    {
      key: 'salaryReleaseDate',
      label: 'Salary release date',
      value: settings.salaryReleaseDate
    }
  ];

  deadlineEntries.forEach((entry) => {
    const deadlineDate = parseDateValue(entry.value);
    if (!deadlineDate) return;

    const diffDays = Math.round((toDateOnly(deadlineDate).getTime() - current.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= leadDays) {
      reminders.push({
        key: entry.key,
        label: entry.label,
        value: entry.value,
        daysUntil: diffDays
      });
    }
  });

  return reminders;
}

async function runPayrollReminderAutomation({ currentDate = new Date(), req = null, source = 'scheduler' } = {}) {
  const settings = await getAutomationSettings();
  const reminders = settings.activePeriod ? evaluatePayrollReminders(settings, currentDate) : [];

  const users = await User.findAll({ where: { isActive: true } });
  const recipientRoles = {
    payrollUploadDeadline: ['HR'],
    financeApprovalDeadline: ['Finance'],
    salaryReleaseDate: null // All active accounts
  };
  const deliveryCounts = { targeted: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 };

  for (const reminder of reminders) {
    const allowedRoles = recipientRoles[reminder.key];
    const emails = [...new Set(users
      .filter((user) => !allowedRoles || allowedRoles.includes(user.role))
      .map((user) => user.email)
      .filter(Boolean))];

    const subject = `${reminder.label} reminder`;
    const html = `
      <h3>${reminder.label} reminder</h3>
      <p>${reminder.label} is scheduled for <strong>${reminder.value}</strong>.</p>
      <p>It is ${reminder.daysUntil === 0 ? 'due today' : `due in ${reminder.daysUntil} day${reminder.daysUntil === 1 ? '' : 's'}`}.</p>
    `;

    deliveryCounts.targeted += emails.length;
    for (const email of emails) {
      const deliveryIdentity = {
        payrollPeriodId: settings.activePeriod ? settings.activePeriod.id : null,
        reminderKey: reminder.key,
        deadline: reminder.value,
        recipient: email
      };

      const previousDelivery = await ReminderDelivery.findOne({
        where: { ...deliveryIdentity, status: 'sent' }
      });
      if (previousDelivery) {
        deliveryCounts.duplicate += 1;
        continue;
      }

      try {
        const result = await sendEmail(email, subject, html);
        if (result && result.skipped) {
          deliveryCounts.skipped += 1;
          await ReminderDelivery.upsert({
            ...deliveryIdentity,
            status: 'skipped',
            source,
            sentAt: null,
            error: result.reason
          });
        } else {
          deliveryCounts.sent += 1;
          await ReminderDelivery.upsert({
            ...deliveryIdentity,
            status: 'sent',
            source,
            sentAt: new Date(),
            error: null
          });
        }
      } catch (err) {
        deliveryCounts.failed += 1;
        await ReminderDelivery.upsert({
          ...deliveryIdentity,
          status: 'failed',
          source,
          sentAt: null,
          error: err.message
        });
        console.error(`Payroll reminder email failed for ${reminder.key}:`, err.message);
      }
    }
  }

  const meta = {
    source,
    reminderCount: reminders.length,
    ...deliveryCounts
  };

  if (req) {
    await logAction(req, source === 'manual' ? 'run_payroll_scheduler' : 'payroll_scheduler', 'AutomationSetting', null, meta);
  } else {
    await logAudit({
      action: source === 'manual' ? 'run_payroll_scheduler' : 'payroll_scheduler',
      entity: 'AutomationSetting',
      meta
    });
  }

  return { settings, reminders, emailed: deliveryCounts.sent, deliveryCounts };
}

function startPayrollAutomationScheduler() {
  if (global.__payrollAutomationSchedulerStarted) return;
  global.__payrollAutomationSchedulerStarted = true;

  const timezone = process.env.PAYROLL_REMINDER_TIMEZONE || 'Asia/Singapore';
  global.__payrollAutomationSchedulerTask = cron.schedule('0 8 * * *', async () => {
    try {
      await runPayrollReminderAutomation({ currentDate: new Date(), source: 'scheduler' });
    } catch (err) {
      console.error('Payroll automation scheduler failed:', err);
    }
  }, {
    timezone,
    noOverlap: true,
    name: 'daily-payroll-reminders'
  });

  console.log(`Payroll reminder scheduler started: daily at 08:00 (${timezone})`);
}

module.exports = {
  DEFAULT_SETTINGS,
  getAutomationSettings,
  saveAutomationSettings,
  evaluatePayrollReminders,
  runPayrollReminderAutomation,
  startPayrollAutomationScheduler
};
