const Stripe = require('stripe');
const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { assertSubscriptionInvoiceTransition } = require('../services/subscriptionInvoiceLifecycle');
const {
  settleStripeSubscriptionPayment,
  failStripeSubscriptionPayment,
  stripeReconciliationState,
  validateRefundableSubscriptionPayment
} = require('../services/subscriptionPayment');
const { logAudit } = require('../utils/audit');
const { generateSubscriptionPaymentReceiptPDF } = require('../utils/subscriptionPaymentReceiptPdf');
const { sendSubscriptionPaymentConfirmation } = require('../services/subscriptionPaymentEmail');
const { recordSubscriptionBankTransfer } = require('../services/subscriptionBankTransfer');
const {
  requirePayPalSandboxConfig,
  paypalSandboxRequest,
  settlePayPalSubscriptionPayment
} = require('../services/subscriptionPayPal');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;

function baseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function invoiceForToken(token) {
  return SubscriptionInvoice.findOne({ where: { publicToken: token } });
}

function pipeReceipt(res, invoice, payment) {
  const receipt = generateSubscriptionPaymentReceiptPDF(invoice, payment);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.number}-receipt.pdf"`);
  receipt.on('error', (error) => {
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else res.destroy(error);
  });
  receipt.pipe(res);
}

async function deliverPaymentConfirmation(req, invoice, payment) {
  try {
    const publicUrl = `${baseUrl(req)}/subscription-invoices/view/${encodeURIComponent(invoice.publicToken)}`;
    const outcome = await sendSubscriptionPaymentConfirmation({ invoice, payment, publicUrl });
    if (outcome.failed) {
      await logAudit({
        userId: req.user ? req.user.id : null,
        action: 'subscription_payment_confirmation_email_failed',
        entity: 'SubscriptionEmailDelivery',
        entityId: outcome.delivery ? outcome.delivery.id : null,
        meta: { subscriptionInvoiceId: invoice.id, subscriptionPaymentId: payment.id, error: outcome.error },
        ip: req.ip || 'webhook',
        userAgent: req.get ? req.get('user-agent') : 'stripe'
      });
    }
    return outcome;
  } catch (error) {
    await logAudit({
      userId: req.user ? req.user.id : null,
      action: 'subscription_payment_confirmation_email_failed',
      entity: 'SubscriptionEmailDelivery',
      entityId: null,
      meta: { subscriptionInvoiceId: invoice.id, subscriptionPaymentId: payment.id, error: error.message },
      ip: req.ip || 'webhook',
      userAgent: req.get ? req.get('user-agent') : 'stripe'
    });
    return { failed: true, error: error.message };
  }
}

exports.createStripeCheckout = async (req, res) => {
  let payment;
  try {
    if (!stripe || !stripeSecretKey.startsWith('sk_test_')) {
      return res.status(503).json({ error: 'Stripe sandbox is not configured.' });
    }
    const invoice = await invoiceForToken(req.params.token);
    if (!invoice || !['Sent', 'Viewed', 'PendingPayment', 'PaymentFailed', 'Overdue'].includes(invoice.status)) {
      return res.status(404).json({ error: 'Payable Subscription Invoice not found.' });
    }
    if (Number(invoice.totalAmount) <= 0) {
      return res.status(409).json({ error: 'Subscription Invoice total must be greater than zero.' });
    }
    const existingPayment = await SubscriptionPayment.findOne({
      where: { invoicePaymentKey: `subscription:${invoice.id}` }
    });
    if (existingPayment) {
      if (existingPayment.status === 'Paid' || invoice.status === 'Paid') {
        return res.status(409).json({ error: 'This Subscription Invoice is already paid.' });
      }
      const checkoutUrl = existingPayment.data && existingPayment.data.checkoutUrl;
      if (existingPayment.status === 'Pending' && checkoutUrl) {
        return res.json({ url: checkoutUrl, reused: true });
      }
      return res.status(409).json({ error: 'A payment is already being prepared for this Subscription Invoice.' });
    }

    payment = await SubscriptionPayment.create({
      subscriptionInvoiceId: invoice.id,
      provider: 'Stripe',
      status: 'Pending',
      expectedAmount: invoice.totalAmount,
      currency: invoice.currency,
      invoicePaymentKey: `subscription:${invoice.id}`,
      attemptedAt: new Date(),
      data: { invoiceNumber: invoice.number }
    });

    const successUrl = `${baseUrl(req)}/subscription-payments/stripe/success?token=${encodeURIComponent(invoice.publicToken)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl(req)}/subscription-invoices/view/${encodeURIComponent(invoice.publicToken)}?payment=cancelled`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: String(invoice.currency).toLowerCase(),
          product_data: {
            name: `Subscription Invoice ${invoice.number}`,
            description: `${invoice.planNameSnapshot} partner subscription`
          },
          unit_amount: Math.round(Number(invoice.totalAmount) * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: invoice.billingEmailSnapshot,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        module: 'subscription_invoice',
        subscriptionInvoiceId: String(invoice.id),
        subscriptionPaymentId: String(payment.id),
        invoiceNumber: invoice.number
      }
    }, {
      idempotencyKey: `subscription-payment-${payment.id}`
    });

    await payment.update({
      checkoutSessionId: session.id,
      data: { ...(payment.data || {}), checkoutUrl: session.url }
    });
    if (invoice.status !== 'PendingPayment') {
      assertSubscriptionInvoiceTransition(invoice.status, 'PendingPayment');
      await invoice.update({ status: 'PendingPayment', paymentPendingAt: new Date() });
    }
    await logAudit({
      userId: null,
      action: 'subscription_payment_checkout_created',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      meta: { subscriptionInvoiceId: invoice.id, invoiceNumber: invoice.number, provider: 'Stripe' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(201).json({ url: session.url });
  } catch (error) {
    if (payment && payment.status === 'Pending') {
      await failStripeSubscriptionPayment({ paymentId: payment.id, reason: error.message }).catch(() => {});
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'A payment is already being prepared for this Subscription Invoice.' });
    }
    res.status(500).json({ error: 'Unable to start Stripe sandbox checkout.' });
  }
};

exports.createPayPalCheckout = async (req, res) => {
  let payment;
  try {
    requirePayPalSandboxConfig();
    const invoice = await invoiceForToken(req.params.token);
    if (!invoice || !['Sent', 'Viewed', 'PendingPayment', 'PaymentFailed', 'Overdue'].includes(invoice.status)) {
      return res.status(404).json({ error: 'Payable Subscription Invoice not found.' });
    }
    if (Number(invoice.totalAmount) <= 0) {
      return res.status(409).json({ error: 'Subscription Invoice total must be greater than zero.' });
    }
    const invoicePaymentKey = `subscription:${invoice.id}`;
    const existingPayment = await SubscriptionPayment.findOne({ where: { invoicePaymentKey } });
    if (existingPayment) {
      if (existingPayment.status === 'Paid' || invoice.status === 'Paid') {
        return res.status(409).json({ error: 'This Subscription Invoice is already paid.' });
      }
      const approvalUrl = existingPayment.data && existingPayment.data.paypalApprovalUrl;
      if (existingPayment.provider === 'PayPal' && existingPayment.status === 'Pending' && approvalUrl) {
        return res.json({ url: approvalUrl, reused: true });
      }
      return res.status(409).json({ error: 'Another payment checkout is still pending for this Subscription Invoice.' });
    }

    payment = await SubscriptionPayment.create({
      subscriptionInvoiceId: invoice.id,
      provider: 'PayPal',
      status: 'Pending',
      expectedAmount: invoice.totalAmount,
      currency: invoice.currency,
      invoicePaymentKey,
      attemptedAt: new Date(),
      data: { invoiceNumber: invoice.number }
    });
    const returnUrl = `${baseUrl(req)}/subscription-payments/paypal/return?invoice_token=${encodeURIComponent(invoice.publicToken)}`;
    const cancelUrl = `${baseUrl(req)}/subscription-invoices/view/${encodeURIComponent(invoice.publicToken)}?payment=cancelled`;
    const order = await paypalSandboxRequest('/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': `subscription-paypal-order-${payment.id}` },
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: String(invoice.id),
          invoice_id: invoice.number,
          description: `${invoice.planNameSnapshot} partner subscription`,
          amount: {
            currency_code: String(invoice.currency).toUpperCase(),
            value: Number(invoice.totalAmount).toFixed(2)
          }
        }],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              return_url: returnUrl,
              cancel_url: cancelUrl
            }
          }
        }
      }
    });
    const approvalUrl = (order.links || []).find(link => ['payer-action', 'approve'].includes(link.rel))?.href;
    if (!order.id || !approvalUrl) throw new Error('PayPal sandbox did not return an approval link.');
    await payment.update({
      data: { ...(payment.data || {}), paypalOrderId: order.id, paypalApprovalUrl: approvalUrl }
    });
    if (invoice.status !== 'PendingPayment') {
      assertSubscriptionInvoiceTransition(invoice.status, 'PendingPayment');
      await invoice.update({ status: 'PendingPayment', paymentPendingAt: new Date() });
    }
    await logAudit({
      userId: null,
      action: 'subscription_paypal_checkout_created',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      meta: { subscriptionInvoiceId: invoice.id, invoiceNumber: invoice.number, provider: 'PayPal', orderId: order.id },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(201).json({ url: approvalUrl });
  } catch (error) {
    if (payment && payment.status === 'Pending') {
      await payment.update({
        status: 'Failed',
        failedAt: new Date(),
        failureReason: error.message,
        invoicePaymentKey: null
      }).catch(() => {});
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'A payment is already being prepared for this Subscription Invoice.' });
    }
    const unavailable = /not configured/.test(error.message);
    res.status(unavailable ? 503 : 502).json({ error: error.message });
  }
};

exports.payPalReturn = async (req, res) => {
  const publicToken = String(req.query.invoice_token || '');
  try {
    requirePayPalSandboxConfig();
    const invoice = await invoiceForToken(publicToken);
    if (!invoice) return res.redirect('/subscription-invoices/view/invalid?payment=error');
    const payment = await SubscriptionPayment.findOne({
      where: { invoicePaymentKey: `subscription:${invoice.id}`, provider: 'PayPal' }
    });
    const orderId = String(req.query.token || '');
    if (!payment || !orderId || String(payment.data && payment.data.paypalOrderId) !== orderId) {
      throw new Error('PayPal return does not match this Subscription Invoice.');
    }
    const order = await paypalSandboxRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': `subscription-paypal-capture-${payment.id}` }
    });
    const result = await settlePayPalSubscriptionPayment({ paymentId: payment.id, order });
    await deliverPaymentConfirmation(req, result.invoice, result.payment);
    await logAudit({
      userId: null,
      action: 'subscription_payment_received',
      entity: 'SubscriptionPayment',
      entityId: result.payment.id,
      meta: {
        subscriptionInvoiceId: result.invoice.id,
        invoiceNumber: result.invoice.number,
        provider: 'PayPal',
        orderId
      },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.redirect(`/subscription-invoices/view/${encodeURIComponent(publicToken)}?payment=paid&provider=paypal`);
  } catch (error) {
    res.redirect(`/subscription-invoices/view/${encodeURIComponent(publicToken)}?payment=error&provider=paypal`);
  }
};

exports.stripeSuccess = async (req, res) => {
  const token = String(req.query.token || '');
  try {
    if (!stripe) throw new Error('Stripe sandbox is not configured.');
    const invoice = await invoiceForToken(token);
    if (!invoice) return res.redirect('/subscription-invoices/view/invalid?payment=error');
    const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    const paymentId = session.metadata && session.metadata.subscriptionPaymentId;
    if (String(session.metadata && session.metadata.subscriptionInvoiceId) !== String(invoice.id)) {
      throw new Error('Stripe session does not match the secure invoice link.');
    }
    const result = await settleStripeSubscriptionPayment({ paymentId, session });
    await deliverPaymentConfirmation(req, result.invoice, result.payment);
    await logAudit({
      userId: null,
      action: 'subscription_payment_received',
      entity: 'SubscriptionPayment',
      entityId: result.payment.id,
      meta: { subscriptionInvoiceId: invoice.id, invoiceNumber: invoice.number, provider: 'Stripe' },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.redirect(`/subscription-invoices/view/${encodeURIComponent(token)}?payment=paid`);
  } catch (error) {
    res.redirect(`/subscription-invoices/view/${encodeURIComponent(token)}?payment=error`);
  }
};

exports.stripeWebhook = async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Subscription Stripe webhook is not configured.' });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).send(`Webhook error: ${error.message}`);
  }

  const session = event.data && event.data.object;
  if (!session || !session.metadata || session.metadata.module !== 'subscription_invoice') {
    return res.json({ received: true, ignored: true });
  }
  try {
    const paymentId = session.metadata.subscriptionPaymentId;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const result = await settleStripeSubscriptionPayment({ paymentId, session });
      await deliverPaymentConfirmation(req, result.invoice, result.payment);
      await logAudit({
        userId: null,
        action: 'subscription_payment_received',
        entity: 'SubscriptionPayment',
        entityId: result.payment.id,
        meta: { subscriptionInvoiceId: result.invoice.id, provider: 'Stripe', eventId: event.id },
        ip: 'webhook',
        userAgent: 'stripe'
      });
    } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      await failStripeSubscriptionPayment({ paymentId, reason: event.type });
    }
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reconcileStripePayment = async (req, res) => {
  try {
    if (!stripe || !stripeSecretKey.startsWith('sk_test_')) {
      return res.status(503).json({ error: 'Stripe sandbox is not configured.' });
    }
    const payment = await SubscriptionPayment.findByPk(req.params.paymentId, {
      include: [{
        model: SubscriptionInvoice,
        as: 'subscriptionInvoice',
        required: true
      }]
    });
    if (!payment) return res.status(404).json({ error: 'Subscription payment not found.' });
    if (payment.provider !== 'Stripe' || !['Pending', 'Failed'].includes(payment.status)) {
      return res.status(409).json({ error: 'Only Pending or Failed Stripe subscription payments can be reconciled.' });
    }
    if (!payment.checkoutSessionId) {
      return res.status(409).json({ error: 'This payment has no Stripe Checkout session to reconcile.' });
    }

    const session = await stripe.checkout.sessions.retrieve(payment.checkoutSessionId);
    const providerState = stripeReconciliationState(session);
    if (providerState === 'Paid') {
      const result = await settleStripeSubscriptionPayment({ paymentId: payment.id, session });
      await deliverPaymentConfirmation(req, result.invoice, result.payment);
      await logAudit({
        userId: req.user.id,
        action: 'subscription_payment_reconciled_paid',
        entity: 'SubscriptionPayment',
        entityId: payment.id,
        meta: {
          subscriptionInvoiceId: result.invoice.id,
          invoiceNumber: result.invoice.number,
          provider: 'Stripe'
        },
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      return res.json({
        status: 'Paid',
        message: 'Stripe confirmed payment. The Subscription Invoice is now Paid.'
      });
    }
    if (providerState === 'Failed') {
      await failStripeSubscriptionPayment({
        paymentId: payment.id,
        reason: 'Stripe Checkout session expired before payment'
      });
      await logAudit({
        userId: req.user.id,
        action: 'subscription_payment_reconciled_failed',
        entity: 'SubscriptionPayment',
        entityId: payment.id,
        meta: { subscriptionInvoiceId: payment.subscriptionInvoiceId, provider: 'Stripe' },
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      return res.json({
        status: 'Failed',
        message: 'Stripe reports that the Checkout session expired without payment.'
      });
    }
    res.status(409).json({
      status: 'Pending',
      error: 'Stripe has not confirmed payment yet. No status was changed.'
    });
  } catch (error) {
    res.status(502).json({ error: `Unable to reconcile with Stripe: ${error.message}` });
  }
};

exports.refundStripePayment = async (req, res) => {
  try {
    if (!stripe || !stripeSecretKey.startsWith('sk_test_')) {
      return res.status(503).json({ error: 'Stripe sandbox is not configured.' });
    }
    const reason = String((req.body && req.body.reason) || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ error: 'A refund reason of at least 3 characters is required.' });
    }
    const payment = await SubscriptionPayment.findByPk(req.params.paymentId, {
      include: [{
        model: SubscriptionInvoice,
        as: 'subscriptionInvoice',
        required: true
      }]
    });
    if (!payment) return res.status(404).json({ error: 'Subscription payment not found.' });
    const amount = validateRefundableSubscriptionPayment(payment, payment.subscriptionInvoice);
    const refund = await stripe.refunds.create({
      payment_intent: payment.providerReference,
      amount: Math.round(amount * 100),
      metadata: {
        module: 'subscription_invoice',
        subscriptionInvoiceId: String(payment.subscriptionInvoiceId),
        subscriptionPaymentId: String(payment.id)
      }
    }, {
      idempotencyKey: `subscription-refund-${payment.id}`
    });
    if (refund.status !== 'succeeded') {
      return res.status(202).json({
        status: refund.status,
        message: 'Stripe accepted the refund request, but it is not confirmed yet. No local status was changed.'
      });
    }

    const transaction = await sequelize.transaction();
    let lockedPayment;
    let lockedInvoice;
    try {
      lockedPayment = await SubscriptionPayment.findByPk(payment.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      lockedInvoice = await SubscriptionInvoice.findByPk(payment.subscriptionInvoiceId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      validateRefundableSubscriptionPayment(lockedPayment, lockedInvoice);
      assertSubscriptionInvoiceTransition(lockedInvoice.status, 'Refunded');
      const refundedAt = new Date();
      await lockedPayment.update({
        status: 'Refunded',
        refundedAt,
        refundReference: refund.id,
        refundAmount: Number(refund.amount) / 100,
        refundReason: reason,
        data: { ...(lockedPayment.data || {}), stripeRefundStatus: refund.status }
      }, { transaction });
      await lockedInvoice.update({ status: 'Refunded', refundedAt }, { transaction });
      await transaction.commit();
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      throw error;
    }

    await logAudit({
      userId: req.user.id,
      action: 'subscription_payment_refunded',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      meta: {
        subscriptionInvoiceId: payment.subscriptionInvoiceId,
        invoiceNumber: payment.subscriptionInvoice.number,
        refundReference: refund.id,
        amount,
        currency: payment.currency,
        reason
      },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json({
      status: 'Refunded',
      message: `Stripe sandbox refund ${refund.id} completed successfully.`
    });
  } catch (error) {
    const status = /Only a confirmed Paid|PaymentIntent|Refund amount/.test(error.message) ? 409 : 502;
    res.status(status).json({ error: error.message });
  }
};

exports.recordBankTransfer = async (req, res) => {
  try {
    const result = await recordSubscriptionBankTransfer({
      invoiceId: req.body && req.body.invoiceId,
      input: req.body || {},
      recordedBy: req.user.id
    });
    const confirmation = await deliverPaymentConfirmation(req, result.invoice, result.payment);
    await logAudit({
      userId: req.user.id,
      action: 'subscription_bank_transfer_recorded',
      entity: 'SubscriptionPayment',
      entityId: result.payment.id,
      meta: {
        subscriptionInvoiceId: result.invoice.id,
        invoiceNumber: result.invoice.number,
        provider: 'BankTransfer',
        reference: result.payment.providerReference,
        amount: result.payment.receivedAmount,
        currency: result.payment.currency
      },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.status(201).json({
      payment: result.payment,
      message: confirmation.failed
        ? 'Bank transfer recorded. The receipt email could not be delivered; check email history.'
        : 'Bank transfer recorded and the payment receipt was emailed.'
    });
  } catch (error) {
    const conflict = /already|pending|Only an unpaid/.test(error.message);
    res.status(conflict ? 409 : 400).json({ error: error.message });
  }
};

exports.publicReceipt = async (req, res) => {
  try {
    const invoice = await SubscriptionInvoice.findOne({
      where: { publicToken: req.params.token }
    });
    if (!invoice || !['Paid', 'Refunded'].includes(invoice.status)) {
      return res.status(404).send('Payment receipt not found.');
    }
    const payment = await SubscriptionPayment.findOne({
      where: {
        subscriptionInvoiceId: invoice.id,
        status: { [Op.in]: ['Paid', 'Refunded'] }
      },
      order: [['paidAt', 'DESC'], ['id', 'DESC']]
    });
    if (!payment) return res.status(404).send('Payment receipt not found.');
    pipeReceipt(res, invoice, payment);
  } catch (error) {
    res.status(500).json({ error: 'Unable to generate payment receipt.' });
  }
};

exports.financeReceipt = async (req, res) => {
  try {
    const payment = await SubscriptionPayment.findByPk(req.params.paymentId, {
      include: [{
        model: SubscriptionInvoice,
        as: 'subscriptionInvoice',
        required: true
      }]
    });
    if (!payment || !['Paid', 'Refunded'].includes(payment.status)) {
      return res.status(404).json({ error: 'Completed Subscription Payment receipt not found.' });
    }
    pipeReceipt(res, payment.subscriptionInvoice, payment);
  } catch (error) {
    res.status(500).json({ error: 'Unable to generate payment receipt.' });
  }
};
