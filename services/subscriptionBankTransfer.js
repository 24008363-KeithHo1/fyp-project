const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { assertSubscriptionInvoiceTransition } = require('./subscriptionInvoiceLifecycle');
const { cents, normalizeCurrency } = require('./subscriptionPayment');

function validateBankTransferInput(input = {}, invoice, now = new Date()) {
  const reference = String(input.reference || '').trim();
  const notes = String(input.notes || '').trim();
  const amount = Number(input.amount);
  const paidAt = new Date(input.paidAt);

  if (!invoice) throw new Error('Subscription Invoice not found.');
  if (!['Sent', 'Viewed', 'PaymentFailed', 'Overdue'].includes(invoice.status)) {
    throw new Error('Only an unpaid delivered Subscription Invoice can be settled by bank transfer.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/ -]{2,99}$/.test(reference)) {
    throw new Error('Bank reference must be 3-100 characters using letters, numbers, spaces, dot, slash, underscore or hyphen.');
  }
  if (!Number.isFinite(amount) || amount <= 0 || cents(amount) !== cents(invoice.totalAmount)) {
    throw new Error('Bank transfer amount must exactly match the Subscription Invoice total.');
  }
  if (!input.paidAt || Number.isNaN(paidAt.getTime())) {
    throw new Error('A valid bank payment date and time is required.');
  }
  if (paidAt.getTime() > now.getTime() + 60 * 1000) {
    throw new Error('Bank payment date cannot be in the future.');
  }
  if (notes.length > 500) throw new Error('Bank transfer notes cannot exceed 500 characters.');

  return {
    reference,
    notes,
    amount: cents(amount) / 100,
    currency: normalizeCurrency(invoice.currency),
    paidAt
  };
}

async function recordSubscriptionBankTransfer({ invoiceId, input, recordedBy }) {
  const transaction = await sequelize.transaction();
  try {
    const invoice = await SubscriptionInvoice.findByPk(invoiceId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const details = validateBankTransferInput(input, invoice);

    const existingReference = await SubscriptionPayment.findOne({
      where: { providerReference: details.reference },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (existingReference) throw new Error('This bank reference has already been recorded.');

    const existingInvoicePayment = await SubscriptionPayment.findOne({
      where: {
        subscriptionInvoiceId: invoice.id,
        status: { [Op.in]: ['Pending', 'Paid', 'Refunded'] }
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (existingInvoicePayment) {
      if (existingInvoicePayment.status === 'Pending') {
        throw new Error('A Stripe checkout is still pending. Reconcile it before recording a bank transfer.');
      }
      throw new Error('This Subscription Invoice already has a completed payment.');
    }

    assertSubscriptionInvoiceTransition(invoice.status, 'Paid');
    const payment = await SubscriptionPayment.create({
      subscriptionInvoiceId: invoice.id,
      provider: 'BankTransfer',
      status: 'Paid',
      expectedAmount: invoice.totalAmount,
      receivedAmount: details.amount,
      currency: details.currency,
      invoicePaymentKey: `subscription:${invoice.id}`,
      providerReference: details.reference,
      attemptedAt: details.paidAt,
      paidAt: details.paidAt,
      data: {
        invoiceNumber: invoice.number,
        notes: details.notes || null,
        recordedBy
      }
    }, { transaction });
    await invoice.update({ status: 'Paid', paidAt: details.paidAt }, { transaction });
    await transaction.commit();
    return { invoice, payment };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

module.exports = {
  validateBankTransferInput,
  recordSubscriptionBankTransfer
};
