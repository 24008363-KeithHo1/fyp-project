const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL, DEFAULT_FROM_EMAIL } = process.env;
const smtpUser = (SMTP_USER || '').trim();
const smtpPass = (SMTP_PASS || '').replace(/\s+/g, '');
const defaultFromEmail = (DEFAULT_FROM_EMAIL || smtpUser || 'fyp00362026@gmail.com').trim();

let transporter = null;
if (SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT || 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass }
  });
}

async function sendEmail(to, subject, html) {
  if (!transporter) {
    console.warn('SMTP not configured; skipping email to', to);
    return { skipped: true, reason: 'SMTP not configured' };
  }
  try {
    const info = await transporter.sendMail({ from: defaultFromEmail || smtpUser, to, subject, html });
    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];

    // A resolved Nodemailer call only means the SMTP transaction completed. Do
    // not record the delivery as sent unless the server accepted its recipient.
    if (rejected.length || !accepted.length) {
      const detail = rejected.length
        ? `Recipient rejected by mail server: ${rejected.join(', ')}`
        : 'Recipient was not accepted by the mail server';
      const error = new Error(detail);
      error.code = 'ERECIPIENT';
      throw error;
    }

    return {
      skipped: false,
      messageId: info.messageId,
      accepted,
      response: info.response
    };
  } catch (err) {
    if (err && (err.code === 'EAUTH' || err.responseCode === 535 || /Username and Password not accepted/i.test(err.message))) {
      throw new Error('Gmail authentication failed. Use a Gmail App Password (with 2-Step Verification enabled) and make sure SMTP_USER is the same Gmail address.');
    }
    throw err;
  }
}

function inviteEmailHtml(link){
  return `<p>You have been invited to join the Automated Invoicing & Payroll system.</p><p>Click to accept: <a href="${link}">${link}</a></p>`;
}

function resetEmailHtml(link){
  return `<p>Reset your password using the link below (expires shortly):</p><p><a href="${link}">${link}</a></p>`;
}

module.exports = { sendEmail, inviteEmailHtml, resetEmailHtml };
