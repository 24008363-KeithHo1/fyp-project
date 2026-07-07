const { Op } = require('sequelize');
const AutomationSetting = require('../models/AutomationSetting');
const User = require('../models/User');
const { sendEmail } = require('../utils/email');
const { logAction, logAudit } = require('../utils/audit');

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
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveAutomationSettings(payload = {}) {
  const allowedKeys = Object.keys(DEFAULT_SETTINGS);
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
  const reminders = evaluatePayrollReminders(settings, currentDate);

  const recipients = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: ['Admin', 'Finance', 'HR'] }
    }
  });

  const emails = recipients
    .map((user) => user.email)
    .filter(Boolean);

  if (emails.length && reminders.length) {
    const subject = 'Payroll reminder';
    const html = `
      <h3>Payroll reminder</h3>
      <p>The following payroll deadlines are approaching:</p>
      <ul>
        ${reminders.map((item) => `<li>${item.label}: ${item.value} (${item.daysUntil} day${item.daysUntil === 1 ? '' : 's'} away)</li>`).join('')}
      </ul>
    `;

    for (const email of emails) {
      try {
        await sendEmail(email, subject, html);
      } catch (err) {
        console.error('Payroll reminder email failed:', err.message);
      }
    }
  }

  const meta = {
    source,
    reminderCount: reminders.length,
    recipients: emails.length
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

  return { settings, reminders, emailed: emails.length };
}

function startPayrollAutomationScheduler() {
  if (global.__payrollAutomationSchedulerStarted) return;
  global.__payrollAutomationSchedulerStarted = true;

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 8 && now.getMinutes() === 0 && now.getSeconds() === 0) {
      runPayrollReminderAutomation({ currentDate: now, source: 'scheduler' }).catch((err) => {
        console.error('Payroll automation scheduler failed:', err);
      });
    }
  }, 1000 * 60);
}

module.exports = {
  DEFAULT_SETTINGS,
  getAutomationSettings,
  saveAutomationSettings,
  evaluatePayrollReminders,
  runPayrollReminderAutomation,
  startPayrollAutomationScheduler
};
