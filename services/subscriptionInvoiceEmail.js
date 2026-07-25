const SubscriptionEmailDelivery = require('../models/SubscriptionEmailDelivery');
const { sendEmail } = require('../utils/email');
const { generateSubscriptionInvoicePDF } = require('../utils/subscriptionInvoicePdf');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function composeSubscriptionInvoiceEmail(invoice, publicUrl) {
  if (!publicUrl) throw new Error('A secure public invoice URL is required.');
  const subject = `Vaniday subscription invoice ${invoice.number}`;
  const html = `
    <p>Dear ${escapeHtml(invoice.businessNameSnapshot)},</p>
    <p>Your Vaniday partner subscription invoice <strong>${escapeHtml(invoice.number)}</strong>
    for <strong>${escapeHtml(invoice.currency)} ${Number(invoice.totalAmount).toFixed(2)}</strong> is ready.</p>
    <p>Payment due date: <strong>${escapeHtml(String(invoice.dueDate).slice(0, 10))}</strong></p>
    <p><a href="${escapeHtml(publicUrl)}">View and pay your invoice securely</a></p>
    <p>A PDF copy is attached for your records.</p>
    <p>Regards,<br>Vaniday Singapore</p>`;
  return { subject, html };
}

async function sendSubscriptionInvoiceEmail({
  invoice,
  items = [],
  publicUrl,
  triggeredBy = null,
  sendEmailFn = sendEmail,
  deliveryModel = SubscriptionEmailDelivery
}) {
  if (!invoice || invoice.status !== 'Approved') {
    throw new Error('Only an Approved subscription invoice can be prepared for sending.');
  }
  const { subject, html } = composeSubscriptionInvoiceEmail(invoice, publicUrl);
  const delivery = await deliveryModel.create({
    subscriptionInvoiceId: invoice.id,
    emailType: 'Invoice',
    recipient: invoice.billingEmailSnapshot,
    subject,
    status: 'Pending',
    attemptedAt: new Date(),
    triggeredBy,
    data: { invoiceNumber: invoice.number }
  });

  try {
    const pdfBuffer = await collectStream(generateSubscriptionInvoicePDF(invoice, items));
    const result = await sendEmailFn(invoice.billingEmailSnapshot, subject, html, {
      attachments: [{
        filename: `${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });
    const skipped = Boolean(result && result.skipped);
    await delivery.update({
      status: skipped ? 'Skipped' : 'Sent',
      messageId: result && result.messageId ? result.messageId : null,
      sentAt: skipped ? null : new Date(),
      errorMessage: skipped ? result.reason || 'Email transport skipped delivery' : null,
      data: {
        invoiceNumber: invoice.number,
        accepted: result && result.accepted ? result.accepted : [],
        response: result && result.response ? result.response : null
      }
    });
    return { delivery, transport: result };
  } catch (error) {
    await delivery.update({
      status: 'Failed',
      failedAt: new Date(),
      errorMessage: error.message
    });
    error.subscriptionDeliveryId = delivery.id;
    throw error;
  }
}

module.exports = {
  escapeHtml,
  collectStream,
  composeSubscriptionInvoiceEmail,
  sendSubscriptionInvoiceEmail
};
