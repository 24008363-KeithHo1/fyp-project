const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { Op } = require('sequelize');
const ReminderDelivery = require('../models/ReminderDelivery');

const FAILURE_MARKERS = [
  'delivery status notification (failure)', 'address not found',
  "wasn't delivered", 'could not be delivered', 'undeliverable',
  'recipient address rejected', 'user unknown', 'mailbox unavailable', '550 5.1.1'
];

function isFailureNotice(subject = '', body = '') {
  const content = `${subject}\n${body}`.toLowerCase();
  return FAILURE_MARKERS.some((marker) => content.includes(marker));
}

function findFailedRecipients(subject, body, recipients) {
  if (!isFailureNotice(subject, body)) return [];
  const content = `${subject}\n${body}`.toLowerCase();
  return recipients.filter((recipient) => content.includes(recipient.toLowerCase()));
}

async function reconcileReminderBounces({ lookbackDays = 30, maxMessages = 100 } = {}) {
  const user = (process.env.IMAP_USER || process.env.SMTP_USER || '').trim();
  const pass = (process.env.IMAP_PASS || process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return { checked: 0, updated: 0, skipped: true };

  const since = new Date(Date.now() - lookbackDays * 86400000);
  const sentDeliveries = await ReminderDelivery.findAll({
    where: { status: 'sent', updatedAt: { [Op.gte]: since } }
  });
  if (!sentDeliveries.length) return { checked: 0, updated: 0 };

  const recipients = [...new Set(sentDeliveries.map((row) => row.recipient.toLowerCase()))];
  const failures = new Map();
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user, pass },
    logger: false
  });
  let checked = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX');
    try {
      const matches = await client.search({ since }, { uid: true });
      const recentUids = matches.slice(-maxMessages);
      checked = recentUids.length;
      if (recentUids.length) {
        for await (const message of client.fetch(recentUids, { envelope: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(message.source);
          const subject = parsed.subject || message.envelope?.subject || '';
          const body = `${parsed.text || ''}\n${parsed.html || ''}`;
          for (const recipient of findFailedRecipients(subject, body, recipients)) {
            failures.set(recipient, `Delivery failure reported by sender mailbox: ${subject || 'recipient address was not found'}`);
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  let updated = 0;
  for (const [recipient, error] of failures) {
    const [count] = await ReminderDelivery.update({ status: 'failed', sentAt: null, error }, {
      where: { status: 'sent', recipient, updatedAt: { [Op.gte]: since } }
    });
    updated += count;
  }
  return { checked, updated };
}

module.exports = { findFailedRecipients, isFailureNotice, reconcileReminderBounces };
