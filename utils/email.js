const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL } = process.env;

let transporter = null;
if (SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT || 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendEmail(to, subject, html) {
  if (!transporter) {
    console.warn('SMTP not configured; skipping email to', to);
    return;
  }
  await transporter.sendMail({ from: SMTP_USER, to, subject, html });
}

function inviteEmailHtml(link){
  return `<p>You have been invited to join the Automated Invoicing & Payroll system.</p><p>Click to accept: <a href="${link}">${link}</a></p>`;
}

function resetEmailHtml(link){
  return `<p>Reset your password using the link below (expires shortly):</p><p><a href="${link}">${link}</a></p>`;
}

module.exports = { sendEmail, inviteEmailHtml, resetEmailHtml };
