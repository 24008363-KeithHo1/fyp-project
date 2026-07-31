const { sendEmail } = require('../utils/email');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmount(amount) {
  return Number(amount || 0).toFixed(2);
}

function buildPaymentReturnEmail({ invoiceNumber, amount, currency, reason }) {
  const text = [
    'Dear Supplier,',
    '',
    'A payment return has been requested for the following invoice:',
    '',
    `Invoice Number: ${invoiceNumber}`,
    `Amount: ${currency} ${formatAmount(amount)}`,
    `Reason: ${reason}`,
    '',
    'Please return the funds using the agreed payment method and reply to this email once the payment has been completed.',
    '',
    'If you require further clarification, please contact our Finance Department.',
    '',
    'Thank you.',
    '',
    'Regards,',
    'Finance Department'
  ].join('\n');

  return {
    subject: `Payment Return Request \u2013 Invoice ${invoiceNumber}`,
    text,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-line;line-height:1.5">${escapeHtml(text)}</div>`
  };
}

async function sendPaymentReturnRequestEmail({ to, invoiceNumber, amount, currency, reason }) {
  const email = buildPaymentReturnEmail({ invoiceNumber, amount, currency, reason });
  const result = await sendEmail(to, email.subject, email.html, { text: email.text });
  if (result && result.skipped) {
    throw new Error(result.reason || 'SMTP not configured');
  }
  return result;
}

module.exports = {
  buildPaymentReturnEmail,
  sendPaymentReturnRequestEmail
};
