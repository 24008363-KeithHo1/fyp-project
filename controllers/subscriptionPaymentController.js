const Stripe = require('stripe');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { assertSubscriptionInvoiceTransition } = require('../services/subscriptionInvoiceLifecycle');
const {
  settleStripeSubscriptionPayment,
  failStripeSubscriptionPayment
} = require('../services/subscriptionPayment');
const { logAudit } = require('../utils/audit');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;

function baseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function invoiceForToken(token) {
  return SubscriptionInvoice.findOne({ where: { publicToken: token } });
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
