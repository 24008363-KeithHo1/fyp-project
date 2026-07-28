const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { assertSubscriptionInvoiceTransition } = require('./subscriptionInvoiceLifecycle');
const { cents, normalizeCurrency } = require('./subscriptionPayment');

const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

function requirePayPalSandboxConfig() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal sandbox is not configured.');
  }
}

async function paypalSandboxRequest(path, options = {}) {
  requirePayPalSandboxConfig();
  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  const tokenResponse = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) {
    throw new Error(token.error_description || 'Unable to authenticate with PayPal sandbox.');
  }

  const response = await fetch(`${PAYPAL_SANDBOX_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || data.error_description || 'PayPal sandbox request failed.');
  return data;
}

function validatePayPalCapture({ invoice, payment, order }) {
  const unit = order && order.purchase_units && order.purchase_units[0];
  const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  if (!invoice || !payment || !order || !unit || !capture) {
    throw new Error('Incomplete PayPal capture data.');
  }
  if (payment.provider !== 'PayPal' || order.status !== 'COMPLETED' || capture.status !== 'COMPLETED') {
    throw new Error('PayPal has not confirmed this subscription payment.');
  }
  if (String(unit.custom_id) !== String(invoice.id)
    || String(unit.invoice_id) !== String(invoice.number)
    || String(payment.data && payment.data.paypalOrderId) !== String(order.id)) {
    throw new Error('PayPal references do not match this Subscription Invoice.');
  }
  if (cents(capture.amount && capture.amount.value) !== cents(payment.expectedAmount)
    || cents(invoice.totalAmount) !== cents(payment.expectedAmount)) {
    throw new Error('PayPal payment amount does not match the Subscription Invoice total.');
  }
  if (normalizeCurrency(capture.amount && capture.amount.currency_code) !== normalizeCurrency(payment.currency)
    || normalizeCurrency(invoice.currency) !== normalizeCurrency(payment.currency)) {
    throw new Error('PayPal payment currency does not match the Subscription Invoice currency.');
  }
  return capture;
}

async function settlePayPalSubscriptionPayment({ paymentId, order }) {
  const transaction = await sequelize.transaction();
  try {
    const payment = await SubscriptionPayment.findByPk(paymentId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!payment) throw new Error('Subscription payment record not found.');
    const invoice = await SubscriptionInvoice.findByPk(payment.subscriptionInvoiceId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!invoice) throw new Error('Subscription Invoice not found.');
    if (payment.status === 'Paid' && invoice.status === 'Paid') {
      await transaction.commit();
      return { payment, invoice, alreadyPaid: true };
    }
    if (invoice.status === 'Paid') throw new Error('Subscription Invoice was already paid by another payment attempt.');

    const capture = validatePayPalCapture({ invoice, payment, order });
    assertSubscriptionInvoiceTransition(invoice.status, 'Paid');
    const paidAt = capture.create_time ? new Date(capture.create_time) : new Date();
    await payment.update({
      status: 'Paid',
      receivedAmount: Number(capture.amount.value),
      providerReference: capture.id,
      paidAt,
      failedAt: null,
      failureReason: null,
      data: { ...(payment.data || {}), paypalOrderStatus: order.status, paypalCaptureStatus: capture.status }
    }, { transaction });
    await invoice.update({ status: 'Paid', paidAt }, { transaction });
    await transaction.commit();
    return { payment, invoice, alreadyPaid: false };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

module.exports = {
  PAYPAL_SANDBOX_BASE,
  requirePayPalSandboxConfig,
  paypalSandboxRequest,
  validatePayPalCapture,
  settlePayPalSubscriptionPayment
};
