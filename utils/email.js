const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL, DEFAULT_FROM_EMAIL } = process.env;
const smtpUser = (SMTP_USER || '').trim();
const smtpPass = (SMTP_PASS || '').replace(/\s+/g, '');
const defaultFromEmail = (DEFAULT_FROM_EMAIL || smtpUser || '').trim();

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
    return;
  }
  try {
    await transporter.sendMail({ from: defaultFromEmail || smtpUser, to, subject, html });
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
