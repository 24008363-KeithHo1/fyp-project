const SubscriptionEmailDelivery = require('../models/SubscriptionEmailDelivery');
const { sendEmail } = require('../utils/email');
const { escapeHtml, collectStream } = require('./subscriptionInvoiceEmail');
const { generateSubscriptionPaymentReceiptPDF } = require('../utils/subscriptionPaymentReceiptPdf');

function receiptDeliveryKey(payment) {
  return `payment:${payment.id}:paid`;
}

function composePaymentConfirmationEmail(invoice, payment, publicUrl) {
  const subject = `Payment received for subscription invoice ${invoice.number}`;
  const method = payment.provider === 'BankTransfer'
    ? 'bank transfer'
    : `${payment.provider} sandbox payment`;
  const html = `
    <p>Dear ${escapeHtml(invoice.businessNameSnapshot)},</p>
    <p>We have received your ${escapeHtml(method)} of
    <strong>${escapeHtml(payment.currency)} ${Number(payment.receivedAmount).toFixed(2)}</strong>
    for subscription invoice <strong>${escapeHtml(invoice.number)}</strong>.</p>
    <p><a href="${escapeHtml(publicUrl)}">View your paid invoice securely</a></p>
    <p>Your payment receipt is attached.</p>
    <p>Regards,<br>Vaniday Singapore</p>`;
  return { subject, html };
}

async function sendSubscriptionPaymentConfirmation({
  invoice,
  payment,
  publicUrl,
  sendEmailFn = sendEmail,
  deliveryModel = SubscriptionEmailDelivery
}) {
  if (!invoice || invoice.status !== 'Paid' || !payment || payment.status !== 'Paid') {
    return { skipped: true, reason: 'Payment is not confirmed Paid.' };
  }
  const reminderKey = receiptDeliveryKey(payment);
  let delivery = await deliveryModel.findOne({
    where: { subscriptionInvoiceId: invoice.id, emailType: 'Receipt', reminderKey }
  });
  if (delivery && ['Sent', 'Delivered'].includes(delivery.status)) {
    return { skipped: true, reason: 'Payment confirmation was already sent.', delivery };
  }
  const { subject, html } = composePaymentConfirmationEmail(invoice, payment, publicUrl);
  try {
    if (delivery) {
      await delivery.update({
        recipient: invoice.billingEmailSnapshot,
        subject,
        status: 'Pending',
        attemptedAt: new Date(),
        failedAt: null,
        errorMessage: null
      });
    } else {
      delivery = await deliveryModel.create({
        subscriptionInvoiceId: invoice.id,
        emailType: 'Receipt',
        reminderKey,
        recipient: invoice.billingEmailSnapshot,
        subject,
        status: 'Pending',
        attemptedAt: new Date(),
        data: { invoiceNumber: invoice.number, subscriptionPaymentId: payment.id }
      });
    }
    const receipt = await collectStream(generateSubscriptionPaymentReceiptPDF(invoice, payment));
    const transport = await sendEmailFn(invoice.billingEmailSnapshot, subject, html, {
      attachments: [{
        filename: `${invoice.number}-receipt.pdf`,
        content: receipt,
        contentType: 'application/pdf'
      }]
    });
    const skipped = Boolean(transport && transport.skipped);
    await delivery.update({
      status: skipped ? 'Skipped' : 'Sent',
      messageId: transport && transport.messageId ? transport.messageId : null,
      sentAt: skipped ? null : new Date(),
      errorMessage: skipped ? transport.reason || 'Email transport skipped delivery' : null
    });
    return { skipped, delivery };
  } catch (error) {
    if (delivery) {
      await delivery.update({ status: 'Failed', failedAt: new Date(), errorMessage: error.message });
    }
    return { skipped: false, failed: true, error: error.message, delivery };
  }
}

module.exports = {
  receiptDeliveryKey,
  composePaymentConfirmationEmail,
  sendSubscriptionPaymentConfirmation
};
