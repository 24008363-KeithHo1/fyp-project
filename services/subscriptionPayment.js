const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { assertSubscriptionInvoiceTransition } = require('./subscriptionInvoiceLifecycle');

function normalizeCurrency(value) {
  return String(value || '').trim().toUpperCase();
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function stripeReconciliationState(session) {
  if (session && session.payment_status === 'paid') return 'Paid';
  if (session && session.status === 'expired') return 'Failed';
  return 'Pending';
}

function validateStripeSettlement({ invoice, payment, session }) {
  if (!invoice || !payment || !session) throw new Error('Incomplete Stripe settlement data.');
  if (String(session.metadata && session.metadata.module) !== 'subscription_invoice') {
    throw new Error('Stripe session does not belong to the Subscription Invoice system.');
  }
  if (String(session.metadata.subscriptionInvoiceId) !== String(invoice.id)
    || String(session.metadata.subscriptionPaymentId) !== String(payment.id)) {
    throw new Error('Stripe session reference does not match this Subscription Invoice payment.');
  }
  if (session.payment_status !== 'paid') {
    throw new Error('Stripe has not confirmed this payment as paid.');
  }
  if (Number(session.amount_total) !== cents(payment.expectedAmount)
    || cents(invoice.totalAmount) !== cents(payment.expectedAmount)) {
    throw new Error('Stripe payment amount does not match the Subscription Invoice total.');
  }
  if (normalizeCurrency(session.currency) !== normalizeCurrency(payment.currency)
    || normalizeCurrency(invoice.currency) !== normalizeCurrency(payment.currency)) {
    throw new Error('Stripe payment currency does not match the Subscription Invoice currency.');
  }
}

async function settleStripeSubscriptionPayment({ paymentId, session }) {
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
    if (!invoice) throw new Error('Subscription invoice not found.');

    if (payment.status === 'Paid' && invoice.status === 'Paid') {
      await transaction.commit();
      return { payment, invoice, alreadyPaid: true };
    }
    if (invoice.status === 'Paid' && payment.status !== 'Paid') {
      throw new Error('Subscription Invoice was already paid by another payment attempt.');
    }

    validateStripeSettlement({ invoice, payment, session });
    if (invoice.status !== 'Paid') assertSubscriptionInvoiceTransition(invoice.status, 'Paid');
    const paidAt = new Date();
    await payment.update({
      status: 'Paid',
      receivedAmount: Number(session.amount_total) / 100,
      providerReference: session.payment_intent || session.id,
      paidAt,
      failedAt: null,
      failureReason: null,
      data: {
        ...(payment.data || {}),
        stripePaymentStatus: session.payment_status,
        stripeSessionStatus: session.status
      }
    }, { transaction });
    if (invoice.status !== 'Paid') {
      await invoice.update({ status: 'Paid', paidAt }, { transaction });
    }
    await transaction.commit();
    return { payment, invoice, alreadyPaid: false };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function failStripeSubscriptionPayment({ paymentId, reason }) {
  const transaction = await sequelize.transaction();
  try {
    const payment = await SubscriptionPayment.findByPk(paymentId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!payment || payment.status === 'Paid') {
      await transaction.commit();
      return payment;
    }
    const invoice = await SubscriptionInvoice.findByPk(payment.subscriptionInvoiceId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const failedAt = new Date();
    await payment.update({
      status: 'Failed',
      failedAt,
      failureReason: String(reason || 'Stripe payment failed'),
      invoicePaymentKey: null
    }, { transaction });
    if (invoice && invoice.status === 'PendingPayment') {
      await invoice.update({ status: 'PaymentFailed', paymentFailedAt: failedAt }, { transaction });
    }
    await transaction.commit();
    return payment;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

module.exports = {
  normalizeCurrency,
  cents,
  stripeReconciliationState,
  validateStripeSettlement,
  settleStripeSubscriptionPayment,
  failStripeSubscriptionPayment
};
