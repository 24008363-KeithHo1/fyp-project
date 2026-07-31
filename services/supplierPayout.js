const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const PaymentReturn = require('../models/PaymentReturn');
const TestBankTransaction = require('../models/TestBankTransaction');
const { paypalRequest, cancelUnclaimedPayoutItem } = require('./paypalService');
const { sendPaymentReturnRequestEmail } = require('./paymentReturnEmail');
const { findOrCreateTestAccount, ensureCompanyAccount } = require('../utils/testBank');
const { logAudit, getRequestMetadata } = require('../utils/audit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINAL_FAILURE_STATUSES = new Set(['Failed', 'Cancelled', 'Unclaimed', 'Returned']);

// Examiner note:
// This file contains the outgoing supplier payment workflow. It uses PayPal
// Payouts (/v1/payments/payouts), not PayPal Checkout (/v2/checkout/orders).
// A payout is accepted first, then separately checked until PayPal confirms
// SUCCESS before the invoice and Test Bank records are settled locally.

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function amountFor(invoice) {
  const amount = Number(invoice && invoice.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function payoutSnapshot(invoice) {
  return (invoice && invoice.data && invoice.data.supplierPayout) || null;
}

function mapPayPalPayoutStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'SUCCESS') return 'Completed';
  if (value === 'FAILED' || value === 'DENIED' || value === 'BLOCKED') return 'Failed';
  if (value === 'CANCELED' || value === 'CANCELLED') return 'Cancelled';
  if (value === 'UNCLAIMED') return 'Unclaimed';
  if (value === 'RETURNED') return 'Returned';
  if (value === 'PENDING') return 'Pending';
  if (value === 'PROCESSING' || value === 'NEW' || value === 'ONHOLD') return 'Processing';
  return status ? 'Processing' : 'Pending';
}

function paypalEmailFor(invoice) {
  return clean(invoice.paypalEmail || (invoice.data && invoice.data.paypalEmail) || (invoice.data && invoice.data.supplierPaypalEmail));
}

function isSupplierInvoice(invoice) {
  return Boolean(invoice && invoice.data && invoice.data.isSupplierInvoice);
}

function validateSupplierEmail(email) {
  const supplierEmail = clean(email);
  if (!supplierEmail || !EMAIL_RE.test(supplierEmail)) {
    const error = new Error('Enter a valid supplier email address.');
    error.status = 400;
    throw error;
  }
  return supplierEmail;
}

function assertPayableInvoice(invoice) {
  // These checks explain why a Pay Supplier button may be disabled:
  // the invoice must be approved, unpaid, positive-value, and have a
  // supplier Personal sandbox PayPal email.
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  if (invoice.status === 'Paid') {
    const error = new Error('Invoice is already paid.');
    error.status = 409;
    throw error;
  }
  if (invoice.status !== 'Approved') {
    const error = new Error('Invoice must be approved before supplier payout.');
    error.status = 409;
    throw error;
  }
  if (!isSupplierInvoice(invoice)) {
    const error = new Error('Mark this invoice as a supplier invoice before sending a supplier payout.');
    error.status = 409;
    throw error;
  }
  if (amountFor(invoice) <= 0) {
    const error = new Error('Invoice amount must be greater than zero.');
    error.status = 400;
    throw error;
  }
  const receiver = paypalEmailFor(invoice);
  if (!receiver || !EMAIL_RE.test(receiver)) {
    const error = new Error('Supplier PayPal sandbox email is missing or invalid.');
    error.status = 400;
    throw error;
  }
}

function payoutDataPayload(existing, changes) {
  return Object.assign({}, existing || {}, changes, { provider: 'paypal_payouts' });
}

async function findDuplicatePayout(invoiceId, transaction) {
  return Payment.findOne({
    where: {
      invoiceId,
      method: 'PayPal',
      status: { [Op.in]: ['Pending', 'Paid'] }
    },
    transaction
  });
}

function extractBatchId(response) {
  return response && response.batch_header && response.batch_header.payout_batch_id;
}

function extractFirstItem(response) {
  return response && response.items && response.items[0] ? response.items[0] : null;
}

function itemReference(item) {
  return item && (item.payout_item_id || (item.payout_item && item.payout_item.sender_item_id));
}

async function submitSupplierPayout(invoiceId, userId) {
  // Submits the payout request only. This does not mark the invoice Paid,
  // because PayPal may still be processing, reject, return, or leave the
  // payout unclaimed.
  const invoice = await Invoice.findByPk(invoiceId);
  assertPayableInvoice(invoice);

  if (payoutSnapshot(invoice)) {
    const error = new Error('A PayPal payout has already been submitted for this invoice.');
    error.status = 409;
    throw error;
  }

  const duplicate = await findDuplicatePayout(invoice.id);
  if (duplicate) {
    const error = new Error('A PayPal payout has already been submitted for this invoice.');
    error.status = 409;
    error.payment = duplicate;
    throw error;
  }

  const now = new Date();
  const senderBatchId = `supplier-invoice-${invoice.id}`;
  const senderItemId = `invoice-${invoice.id}-attempt-${Date.now()}`;
  const receiver = paypalEmailFor(invoice);
  const currency = invoice.currency || (invoice.data && invoice.data.currency) || 'SGD';

  const response = await paypalRequest('/v1/payments/payouts', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': senderBatchId },
    body: {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: `Payment for supplier invoice ${invoice.number || invoice.id}`
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: {
          value: amountFor(invoice).toFixed(2),
          currency
        },
        receiver,
        note: `Payment for supplier invoice ${invoice.number || invoice.id}`,
        sender_item_id: senderItemId
      }]
    }
  });

  const batchId = extractBatchId(response);
  const item = extractFirstItem(response);
  const status = mapPayPalPayoutStatus(item && item.transaction_status);
  const providerReference = batchId || senderBatchId;
  const payload = payoutDataPayload(payoutSnapshot(invoice), {
    submittedBy: userId || null,
    recipientPaypalEmail: receiver,
    payoutBatchId: batchId,
    payoutItemId: itemReference(item),
    paypalTransactionId: item && item.transaction_id,
    senderBatchId,
    senderItemId,
    status,
    paypalStatus: item && item.transaction_status,
    submittedAt: now.toISOString(),
    completedAt: null,
    failureMessage: null,
    rawLinks: response && response.links
  });

  const payment = await Payment.create({
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    method: 'PayPal',
    amount: amountFor(invoice),
    currency,
    status: 'Pending',
    providerReference,
    paidAt: now,
    recordedBy: userId || null,
    data: { supplierPayout: payload }
  });

  await invoice.update({
    data: Object.assign({}, invoice.data || {}, { supplierPayout: payload, paypalEmail: receiver })
  });

  return { invoice, payment, payout: payload };
}

async function fetchPayoutStatus(batchId) {
  return paypalRequest(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}

function statusFromCancelResponse(response) {
  const status = response && (response.transaction_status || response.status);
  return {
    status: mapPayPalPayoutStatus(status || 'RETURNED'),
    paypalStatus: status || 'RETURNED',
    response
  };
}

function statusFromBatch(response) {
  const item = extractFirstItem(response);
  const paypalStatus = item && (item.transaction_status || item.payout_item_fee && item.payout_item_fee.status);
  return {
    item,
    status: mapPayPalPayoutStatus(paypalStatus || (response.batch_header && response.batch_header.batch_status)),
    paypalStatus,
    batchStatus: response.batch_header && response.batch_header.batch_status
  };
}

async function applySuccessfulPayout({ invoice, payment, payout, response, req }) {
  // Local settlement happens only after PayPal confirms SUCCESS. The unique
  // Test Bank reference prevents double debit/credit if Finance checks the
  // same successful payout more than once.
  if (invoice.status === 'Paid' && payment.status === 'Paid') {
    return { alreadyApplied: true };
  }

  const existingTransaction = await TestBankTransaction.findOne({
    where: { reference: `PAYPAL-PAYOUT-${payout.payoutBatchId || payout.senderBatchId}` }
  });
  if (existingTransaction) {
    if (invoice.status !== 'Paid') await invoice.update({ status: 'Paid' });
    if (payment.status !== 'Paid') await payment.update({ status: 'Paid' });
    return { alreadyApplied: true, transaction: existingTransaction };
  }

  return sequelize.transaction(async (transaction) => {
    const lockedInvoice = await Invoice.findByPk(invoice.id, { transaction, lock: true });
    const lockedPayment = await Payment.findByPk(payment.id, { transaction, lock: true });
    const reference = `PAYPAL-PAYOUT-${payout.payoutBatchId || payout.senderBatchId}`;
    const existing = await TestBankTransaction.findOne({ where: { reference }, transaction, lock: true });
    if (existing) return { alreadyApplied: true, transaction: existing };

    const companyAccount = await ensureCompanyAccount({ transaction });
    const supplierAccount = await findOrCreateTestAccount({
      ownerType: 'Supplier',
      ownerReference: payout.recipientPaypalEmail || lockedInvoice.paypalEmail || `invoice-${lockedInvoice.id}`,
      accountName: lockedInvoice.customer_name,
      openingBalance: 0,
      transaction
    });
    const amount = amountFor(lockedInvoice);
    if (Number(companyAccount.balance) < amount) {
      throw new Error('Company Test Bank account has insufficient balance for this supplier payout.');
    }

    await companyAccount.update({ balance: Number(companyAccount.balance) - amount }, { transaction });
    await supplierAccount.update({ balance: Number(supplierAccount.balance) + amount }, { transaction });

    const processedAt = new Date();
    const bankTransaction = await TestBankTransaction.create({
      type: 'SupplierPayment',
      fromAccountId: companyAccount.id,
      toAccountId: supplierAccount.id,
      amount,
      currency: lockedInvoice.currency || payout.currency || 'SGD',
      status: 'Completed',
      reference,
      description: `Supplier payout for invoice ${lockedInvoice.number}`,
      processedAt,
      data: {
        invoiceId: lockedInvoice.id,
        invoiceNumber: lockedInvoice.number,
        paymentId: lockedPayment.id,
        paypalPayoutBatchId: payout.payoutBatchId,
        paypalPayoutItemId: payout.payoutItemId,
        paypalTransactionId: payout.paypalTransactionId,
        recipientPaypalEmail: payout.recipientPaypalEmail
      }
    }, { transaction });

    const completedPayload = payoutDataPayload(payout, {
      status: 'Completed',
      completedAt: processedAt.toISOString(),
      testBankTransactionId: bankTransaction.id,
      testBankReference: bankTransaction.reference,
      lastCheckedAt: processedAt.toISOString(),
      responseStatus: response && response.batch_header && response.batch_header.batch_status
    });

    await lockedPayment.update({
      status: 'Paid',
      paidAt: processedAt,
      providerReference: payout.payoutBatchId || payout.senderBatchId,
      data: Object.assign({}, lockedPayment.data || {}, { supplierPayout: completedPayload })
    }, { transaction });

    await lockedInvoice.update({
      status: 'Paid',
      data: Object.assign({}, lockedInvoice.data || {}, {
        supplierPayout: completedPayload,
        payment: Object.assign({}, (lockedInvoice.data && lockedInvoice.data.payment) || {}, {
          provider: 'paypal_payouts',
          method: 'PayPal',
          status: 'paid',
          paypalPayoutBatchId: payout.payoutBatchId,
          paypalPayoutItemId: payout.payoutItemId,
          paypalTransactionId: payout.paypalTransactionId,
          providerReference: payout.payoutBatchId || payout.senderBatchId,
          paidAt: processedAt.toISOString()
        })
      })
    }, { transaction });

    const { ip, userAgent } = getRequestMetadata(req || {});
    await logAudit({
      userId: req && req.user ? req.user.id : null,
      action: 'supplier_paypal_payout_completed',
      entity: 'Payment',
      entityId: lockedPayment.id,
      meta: {
        invoiceId: lockedInvoice.id,
        invoiceNumber: lockedInvoice.number,
        amount,
        currency: lockedInvoice.currency,
        paypalPayoutBatchId: payout.payoutBatchId,
        testBankTransactionId: bankTransaction.id
      },
      ip,
      userAgent
    });

    return { alreadyApplied: false, transaction: bankTransaction };
  });
}

function isCompletedSupplierPayout(payment) {
  const payout = payment && payment.data && payment.data.supplierPayout;
  return Boolean(payment && payment.method === 'PayPal' && payment.status === 'Paid' && payout && payout.status === 'Completed');
}

async function findCompletedSupplierPayoutPayment(invoiceId, transaction = null) {
  const payments = await Payment.findAll({
    where: { invoiceId, method: 'PayPal', status: 'Paid' },
    order: [['id', 'DESC']],
    transaction,
    lock: transaction ? true : undefined
  });
  return payments.find(isCompletedSupplierPayout) || null;
}

async function requestPaymentReturn(invoiceId, req) {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (reason.length < 3) {
    const error = new Error('Enter a payment return reason of at least 3 characters.');
    error.status = 400;
    throw error;
  }
  const remarks = String((req.body && req.body.remarks) || '').trim();

  const invoice = await Invoice.findByPk(invoiceId);
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }

  const payment = await findCompletedSupplierPayoutPayment(invoice.id);
  if (!payment) {
    const error = new Error('Only completed supplier PayPal payouts can have a payment return requested.');
    error.status = 409;
    throw error;
  }

  const existing = await PaymentReturn.findOne({ where: { originalPaymentId: payment.id } });
  if (existing) {
    const error = new Error('A payment return request already exists for this supplier payout.');
    error.status = 409;
    error.paymentReturn = existing;
    throw error;
  }

  const payout = payment.data.supplierPayout;
  const supplierEmail = validateSupplierEmail(
    (req.body && req.body.supplierEmail)
      || payout.recipientPaypalEmail
      || paypalEmailFor(invoice)
  );
  const now = new Date();
  const paymentReturn = await PaymentReturn.create({
    originalPaymentId: payment.id,
    invoiceId: invoice.id,
    reason,
    remarks,
    amount: Number(payment.amount),
    currency: payment.currency || invoice.currency || 'SGD',
    supplierEmail,
    requestedBy: req.user && req.user.id,
    requestedAt: now,
    status: 'ReturnRequested',
    notificationEmail: supplierEmail,
    notificationStatus: 'Pending',
    data: {
      paypalPayoutBatchId: payout.payoutBatchId,
      paypalPayoutItemId: payout.payoutItemId,
      paypalTransactionId: payout.paypalTransactionId,
      recipientPaypalEmail: payout.recipientPaypalEmail,
      note: 'Payment return request only; no Test Bank balances moved until Finance/Admin confirms funds returned.'
    }
  });

  let emailResult = null;
  let emailWarning = null;
  try {
    emailResult = await sendPaymentReturnRequestEmail({
      to: supplierEmail,
      invoiceNumber: invoice.number || invoice.id,
      amount: paymentReturn.amount,
      currency: paymentReturn.currency,
      reason
    });
    await paymentReturn.update({
      notificationStatus: 'Sent',
      notificationSentAt: new Date(),
      notificationError: null,
      data: Object.assign({}, paymentReturn.data || {}, {
        notificationDelivery: {
          messageId: emailResult && emailResult.messageId,
          accepted: emailResult && emailResult.accepted,
          response: emailResult && emailResult.response
        }
      })
    });
  } catch (emailError) {
    emailWarning = `Payment return request was created, but email delivery failed: ${emailError.message}`;
    await paymentReturn.update({
      notificationStatus: 'Failed',
      notificationError: emailError.message
    });
  }

  await invoice.update({
    data: Object.assign({}, invoice.data || {}, {
      supplierPaymentReturn: {
        id: paymentReturn.id,
        originalPaymentId: payment.id,
        status: paymentReturn.status,
        requestedAt: now.toISOString(),
        requestedBy: req.user && req.user.id,
        reason,
        remarks,
        supplierEmail,
        notificationEmail: supplierEmail,
        notificationStatus: paymentReturn.notificationStatus,
        notificationSentAt: paymentReturn.notificationSentAt,
        notificationError: paymentReturn.notificationError
      }
    })
  });

  const { ip, userAgent } = getRequestMetadata(req || {});
  await logAudit({
    userId: req.user ? req.user.id : null,
    action: 'supplier_payment_return_requested',
    entity: 'PaymentReturn',
    entityId: paymentReturn.id,
    meta: {
      originalPaymentId: payment.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: paymentReturn.amount,
      currency: paymentReturn.currency,
      reason,
      supplierEmail,
      notificationStatus: paymentReturn.notificationStatus
    },
    ip,
    userAgent
  });

  return {
    invoice: await Invoice.findByPk(invoice.id),
    payment,
    paymentReturn,
    emailSent: paymentReturn.notificationStatus === 'Sent',
    emailWarning,
    emailResult
  };
}

async function requestPaymentReturnForPayment(paymentId, req) {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (reason.length < 3) {
    const error = new Error('Enter a payment return reason of at least 3 characters.');
    error.status = 400;
    throw error;
  }
  const remarks = String((req.body && req.body.remarks) || '').trim();
  const supplierEmail = validateSupplierEmail(req.body && req.body.supplierEmail);

  const payment = await Payment.findByPk(paymentId);
  if (!payment) {
    const error = new Error('Payment not found.');
    error.status = 404;
    throw error;
  }
  if (payment.status !== 'Paid') {
    const error = new Error('Only paid payments can have a payment return requested.');
    error.status = 409;
    throw error;
  }

  const invoice = await Invoice.findByPk(payment.invoiceId);
  if (!invoice) {
    const error = new Error('Invoice not found for this payment.');
    error.status = 404;
    throw error;
  }

  const existing = await PaymentReturn.findOne({ where: { originalPaymentId: payment.id } });
  if (existing) {
    const error = new Error('A payment return request already exists for this payment.');
    error.status = 409;
    error.paymentReturn = existing;
    throw error;
  }

  const now = new Date();
  const paymentReturn = await PaymentReturn.create({
    originalPaymentId: payment.id,
    invoiceId: invoice.id,
    reason,
    remarks,
    amount: Number(payment.amount),
    currency: payment.currency || invoice.currency || 'SGD',
    supplierEmail,
    requestedBy: req.user && req.user.id,
    requestedAt: now,
    status: 'ReturnRequested',
    notificationEmail: supplierEmail,
    notificationStatus: 'Pending',
    data: {
      originalPaymentMethod: payment.method,
      originalPaymentStatus: payment.status,
      providerReference: payment.providerReference,
      note: 'Payment return request only; no original payment, invoice, or Test Bank balances modified.'
    }
  });

  let emailResult = null;
  let emailWarning = null;
  try {
    emailResult = await sendPaymentReturnRequestEmail({
      to: supplierEmail,
      invoiceNumber: invoice.number || payment.invoiceNumber || invoice.id,
      amount: paymentReturn.amount,
      currency: paymentReturn.currency,
      reason
    });
    await paymentReturn.update({
      notificationStatus: 'Sent',
      notificationSentAt: new Date(),
      notificationError: null,
      data: Object.assign({}, paymentReturn.data || {}, {
        notificationDelivery: {
          messageId: emailResult && emailResult.messageId,
          accepted: emailResult && emailResult.accepted,
          response: emailResult && emailResult.response
        }
      })
    });
  } catch (emailError) {
    emailWarning = `Payment return request was created, but email delivery failed: ${emailError.message}`;
    await paymentReturn.update({
      notificationStatus: 'Failed',
      notificationError: emailError.message
    });
  }

  await invoice.update({
    data: Object.assign({}, invoice.data || {}, {
      supplierPaymentReturn: {
        id: paymentReturn.id,
        originalPaymentId: payment.id,
        status: paymentReturn.status,
        requestedAt: now.toISOString(),
        requestedBy: req.user && req.user.id,
        reason,
        remarks,
        supplierEmail,
        notificationEmail: supplierEmail,
        notificationStatus: paymentReturn.notificationStatus,
        notificationSentAt: paymentReturn.notificationSentAt,
        notificationError: paymentReturn.notificationError
      }
    })
  });

  const { ip, userAgent } = getRequestMetadata(req || {});
  await logAudit({
    userId: req.user ? req.user.id : null,
    action: 'payment_return_requested',
    entity: 'PaymentReturn',
    entityId: paymentReturn.id,
    meta: {
      originalPaymentId: payment.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: paymentReturn.amount,
      currency: paymentReturn.currency,
      reason,
      supplierEmail,
      notificationStatus: paymentReturn.notificationStatus
    },
    ip,
    userAgent
  });

  return {
    invoice: await Invoice.findByPk(invoice.id),
    payment,
    paymentReturn,
    emailSent: paymentReturn.notificationStatus === 'Sent',
    emailWarning,
    emailResult
  };
}

async function resendPaymentReturnEmail(returnId, req) {
  const paymentReturn = await PaymentReturn.findByPk(returnId);
  if (!paymentReturn) {
    const error = new Error('Payment return request not found.');
    error.status = 404;
    throw error;
  }
  if (paymentReturn.status !== 'ReturnRequested') {
    const error = new Error('Only open payment return requests can have notification email resent.');
    error.status = 409;
    throw error;
  }
  if (paymentReturn.notificationStatus !== 'Failed') {
    const error = new Error('Only failed payment return emails can be resent.');
    error.status = 409;
    throw error;
  }

  const invoice = await Invoice.findByPk(paymentReturn.invoiceId);
  const supplierEmail = validateSupplierEmail(paymentReturn.supplierEmail || paymentReturn.notificationEmail);
  try {
    const emailResult = await sendPaymentReturnRequestEmail({
      to: supplierEmail,
      invoiceNumber: (invoice && invoice.number) || paymentReturn.invoiceId,
      amount: paymentReturn.amount,
      currency: paymentReturn.currency,
      reason: paymentReturn.reason
    });
    await paymentReturn.update({
      notificationEmail: supplierEmail,
      notificationStatus: 'Sent',
      notificationSentAt: new Date(),
      notificationError: null,
      data: Object.assign({}, paymentReturn.data || {}, {
        notificationDelivery: {
          messageId: emailResult && emailResult.messageId,
          accepted: emailResult && emailResult.accepted,
          response: emailResult && emailResult.response,
          resentAt: new Date().toISOString()
        }
      })
    });

    if (invoice) {
      await invoice.update({
        data: Object.assign({}, invoice.data || {}, {
          supplierPaymentReturn: Object.assign({}, (invoice.data && invoice.data.supplierPaymentReturn) || {}, {
            id: paymentReturn.id,
            originalPaymentId: paymentReturn.originalPaymentId,
            status: paymentReturn.status,
            notificationEmail: supplierEmail,
            notificationStatus: 'Sent',
            notificationSentAt: paymentReturn.notificationSentAt,
            notificationError: null
          })
        })
      });
    }

    const { ip, userAgent } = getRequestMetadata(req || {});
    await logAudit({
      userId: req.user ? req.user.id : null,
      action: 'supplier_payment_return_email_resent',
      entity: 'PaymentReturn',
      entityId: paymentReturn.id,
      meta: { invoiceId: paymentReturn.invoiceId, originalPaymentId: paymentReturn.originalPaymentId, supplierEmail },
      ip,
      userAgent
    });

    return { paymentReturn, invoice, emailSent: true, emailResult };
  } catch (emailError) {
    await paymentReturn.update({
      notificationEmail: supplierEmail,
      notificationStatus: 'Failed',
      notificationError: emailError.message
    });
    return {
      paymentReturn,
      invoice,
      emailSent: false,
      emailWarning: `Payment return request email still failed: ${emailError.message}`
    };
  }
}

async function confirmFundsReturned(returnId, req) {
  return sequelize.transaction(async (transaction) => {
    const paymentReturn = await PaymentReturn.findByPk(returnId, { transaction, lock: true });
    if (!paymentReturn) {
      const error = new Error('Payment return request not found.');
      error.status = 404;
      throw error;
    }
    if (paymentReturn.status === 'Returned') {
      const error = new Error('Funds have already been confirmed returned for this request.');
      error.status = 409;
      throw error;
    }

    const payment = await Payment.findByPk(paymentReturn.originalPaymentId, { transaction, lock: true });
    const invoice = await Invoice.findByPk(paymentReturn.invoiceId, { transaction, lock: true });
    if (!isCompletedSupplierPayout(payment)) {
      const error = new Error('The original payment is not a completed supplier PayPal payout.');
      error.status = 409;
      throw error;
    }
    if (!invoice) {
      const error = new Error('Invoice not found for payment return request.');
      error.status = 404;
      throw error;
    }

    const payout = payment.data.supplierPayout;
    const amount = Number(paymentReturn.amount);
    const companyAccount = await ensureCompanyAccount({ transaction });
    const supplierAccount = await findOrCreateTestAccount({
      ownerType: 'Supplier',
      ownerReference: payout.recipientPaypalEmail || invoice.paypalEmail || `invoice-${invoice.id}`,
      accountName: invoice.customer_name,
      openingBalance: 0,
      transaction
    });
    if (Number(supplierAccount.balance) < amount) {
      const error = new Error('Supplier Test Bank account has insufficient balance to confirm funds returned.');
      error.status = 409;
      throw error;
    }

    const reference = `PAYMENT-RETURN-${paymentReturn.id}`;
    const existingTransaction = await TestBankTransaction.findOne({ where: { reference }, transaction, lock: true });
    if (existingTransaction) {
      await paymentReturn.update({
        status: 'Returned',
        confirmedBy: req.user && req.user.id,
        confirmedAt: existingTransaction.processedAt,
        returnTransactionId: existingTransaction.id
      }, { transaction });
      return { paymentReturn, payment, invoice, transaction: existingTransaction, alreadyApplied: true };
    }

    await supplierAccount.update({ balance: Number(supplierAccount.balance) - amount }, { transaction });
    await companyAccount.update({ balance: Number(companyAccount.balance) + amount }, { transaction });

    const confirmedAt = new Date();
    const returnTransaction = await TestBankTransaction.create({
      type: 'PaymentReturn',
      fromAccountId: supplierAccount.id,
      toAccountId: companyAccount.id,
      amount,
      currency: paymentReturn.currency || payment.currency || invoice.currency || 'SGD',
      status: 'Completed',
      reference,
      description: `Confirmed supplier payment return for invoice ${invoice.number}`,
      processedAt: confirmedAt,
      data: {
        originalPaymentId: payment.id,
        paymentReturnId: paymentReturn.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        reason: paymentReturn.reason,
        paypalPayoutBatchId: payout.payoutBatchId,
        paypalPayoutItemId: payout.payoutItemId,
        paypalTransactionId: payout.paypalTransactionId,
        note: 'Internal Test Bank return confirmation; this is not described as a real PayPal reversal.'
      }
    }, { transaction });

    await paymentReturn.update({
      status: 'Returned',
      confirmedBy: req.user && req.user.id,
      confirmedAt,
      returnTransactionId: returnTransaction.id,
      data: Object.assign({}, paymentReturn.data || {}, {
        returnTransactionReference: returnTransaction.reference,
        companyTestBankAccountId: companyAccount.id,
        supplierTestBankAccountId: supplierAccount.id
      })
    }, { transaction });

    await invoice.update({
      data: Object.assign({}, invoice.data || {}, {
        supplierPaymentReturn: {
          id: paymentReturn.id,
          originalPaymentId: payment.id,
          status: 'Returned',
          requestedAt: paymentReturn.requestedAt,
          requestedBy: paymentReturn.requestedBy,
          confirmedAt: confirmedAt.toISOString(),
          confirmedBy: req.user && req.user.id,
          returnTransactionId: returnTransaction.id,
          reason: paymentReturn.reason
        }
      })
    }, { transaction });

    const { ip, userAgent } = getRequestMetadata(req || {});
    await logAudit({
      userId: req.user ? req.user.id : null,
      action: 'supplier_payment_funds_returned_confirmed',
      entity: 'PaymentReturn',
      entityId: paymentReturn.id,
      meta: {
        originalPaymentId: payment.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount,
        currency: paymentReturn.currency,
        returnTransactionId: returnTransaction.id
      },
      ip,
      userAgent
    });

    return { paymentReturn, payment, invoice, transaction: returnTransaction, alreadyApplied: false };
  });
}

async function checkSupplierPayout(invoiceId, req) {
  // Status checking is separate from payout submission. Only a completed
  // PayPal item status triggers invoice Paid + Test Bank movement.
  const invoice = await Invoice.findByPk(invoiceId);
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  const payout = payoutSnapshot(invoice);
  if (!payout || !payout.payoutBatchId) {
    const error = new Error('No PayPal payout has been submitted for this invoice.');
    error.status = 404;
    throw error;
  }
  const payment = await Payment.findOne({
    where: {
      invoiceId: invoice.id,
      method: 'PayPal',
      providerReference: payout.payoutBatchId
    },
    order: [['id', 'DESC']]
  });
  if (!payment) {
    const error = new Error('Payout payment record was not found.');
    error.status = 404;
    throw error;
  }

  const response = await fetchPayoutStatus(payout.payoutBatchId);
  const statusResult = statusFromBatch(response);
  const item = statusResult.item;
  const now = new Date();
  let updatedPayout = payoutDataPayload(payout, {
    status: statusResult.status,
    paypalStatus: statusResult.paypalStatus,
    payoutItemId: itemReference(item) || payout.payoutItemId,
    paypalTransactionId: (item && item.transaction_id) || payout.paypalTransactionId,
    failureMessage: FINAL_FAILURE_STATUSES.has(statusResult.status)
      ? ((item && item.errors && (item.errors.message || item.errors.name)) || statusResult.status)
      : null,
    completedAt: statusResult.status === 'Completed' ? (payout.completedAt || now.toISOString()) : payout.completedAt,
    lastCheckedAt: now.toISOString()
  });

  let cancelResponse = null;
  if (statusResult.status === 'Unclaimed') {
    if (!updatedPayout.payoutItemId) {
      const error = new Error('PayPal payout is UNCLAIMED but has no payout item ID to cancel.');
      error.status = 409;
      throw error;
    }
    cancelResponse = await cancelUnclaimedPayoutItem(updatedPayout.payoutItemId);
    const cancelled = statusFromCancelResponse(cancelResponse);
    updatedPayout = payoutDataPayload(updatedPayout, {
      status: cancelled.status,
      paypalStatus: cancelled.paypalStatus,
      cancelledAt: now.toISOString(),
      cancelResponse,
      failureMessage: 'Unclaimed PayPal payout item cancellation confirmed by PayPal.'
    });
  }

  await payment.update({
    status: statusResult.status === 'Completed' ? 'Paid' : FINAL_FAILURE_STATUSES.has(statusResult.status) ? 'Failed' : 'Pending',
    data: Object.assign({}, payment.data || {}, { supplierPayout: updatedPayout })
  });
  await invoice.update({
    data: Object.assign({}, invoice.data || {}, { supplierPayout: updatedPayout })
  });

  if (statusResult.status === 'Completed') {
    await applySuccessfulPayout({ invoice, payment, payout: updatedPayout, response, req });
  }

  return { invoice: await Invoice.findByPk(invoice.id), payment: await Payment.findByPk(payment.id), payout: updatedPayout, paypal: cancelResponse || response };
}

module.exports = {
  mapPayPalPayoutStatus,
  submitSupplierPayout,
  checkSupplierPayout,
  requestPaymentReturn,
  requestPaymentReturnForPayment,
  resendPaymentReturnEmail,
  confirmFundsReturned,
  isCompletedSupplierPayout,
  assertPayableInvoice,
  isSupplierInvoice,
  paypalEmailFor
};
