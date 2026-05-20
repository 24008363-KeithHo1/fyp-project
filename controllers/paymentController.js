const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const { logAudit, getRequestMetadata } = require('../utils/audit');

async function recordPayment(invoice, paymentData) {
  const providerReference = paymentData.providerReference || `${paymentData.method}-${invoice.id}-${Date.now()}`;
  const payload = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    method: paymentData.method,
    amount: paymentData.amount || Number(invoice.amount),
    currency: paymentData.currency || 'SGD',
    status: paymentData.status || 'Paid',
    providerReference,
    paidAt: paymentData.paidAt || new Date(),
    recordedBy: paymentData.recordedBy || null,
    data: paymentData.data || {}
  };

  const existing = await Payment.findOne({ where: { providerReference } });
  if (existing) {
    await existing.update(payload);
    return existing;
  }

  return Payment.create(payload);
}

function getBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function markInvoicePaid(invoiceId, paymentData) {
  if (!invoiceId) return null;
  const invoice = await Invoice.findByPk(invoiceId);
  if (!invoice) return null;

  const data = Object.assign({}, invoice.data || {}, {
    payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, paymentData, {
      paidAt: new Date().toISOString()
    })
  });

  await invoice.update({ status: 'Paid', data });
  await recordPayment(invoice, {
    method: paymentData.method || 'Stripe',
    amount: paymentData.amountReceived || Number(invoice.amount),
    currency: paymentData.currency ? paymentData.currency.toUpperCase() : 'SGD',
    providerReference: paymentData.paymentIntentId || paymentData.checkoutSessionId,
    data: paymentData
  });
  return invoice;
}

exports.createCheckoutSession = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'sgd',
          product_data: {
            name: `Invoice ${invoice.number || invoice.id}`
          },
          unit_amount: Math.round(Number(invoice.amount) * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${getBaseUrl(req)}/payment/success?invoice=${invoice.id}`,
      cancel_url: `${getBaseUrl(req)}/payment/cancel?invoice=${invoice.id}`,
      metadata: {
        invoiceId: invoice.id
      }
    });

    const data = Object.assign({}, invoice.data || {}, {
      payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
        provider: 'stripe',
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        createdAt: new Date().toISOString()
      })
    });
    await invoice.update({ data });
    const { ip, userAgent } = getRequestMetadata(req);
    await logAudit({ userId: req.user ? req.user.id : null, action: 'payment_checkout_created', entity: 'Payment', entityId: invoice.id, meta: { invoiceNumber: invoice.number, amount: invoice.amount, provider: 'stripe', sessionId: session.id }, ip, userAgent });

    res.json({ url: session.url });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.handleWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    if (webhookSecret && webhookSecret !== 'whsec_your_webhook_secret_here') {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString('utf8'));
    }
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const invoice = await markInvoicePaid(session.metadata && session.metadata.invoiceId, {
        provider: 'stripe',
        method: 'Stripe',
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent,
        amountReceived: session.amount_total ? session.amount_total / 100 : undefined,
        currency: session.currency,
        status: session.payment_status || 'paid'
      });
      if (invoice) {
        await logAudit({ userId: null, action: 'payment_received', entity: 'Payment', entityId: invoice.id, meta: { invoiceNumber: invoice.number, amount: session.amount_total / 100, provider: 'stripe', sessionId: session.id }, ip: 'webhook', userAgent: 'stripe' });
      }
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const invoiceId = session.metadata && session.metadata.invoiceId;
      const invoice = invoiceId ? await Invoice.findByPk(invoiceId) : null;
      if (invoice) {
        const data = Object.assign({}, invoice.data || {}, {
          payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
            provider: 'stripe',
            checkoutSessionId: session.id,
            status: 'failed',
            failedAt: new Date().toISOString()
          })
        });
        await invoice.update({ data });
        await logAudit({ userId: null, action: 'payment_failed', entity: 'Payment', entityId: invoice.id, meta: { invoiceNumber: invoice.number, reason: 'stripe_async_payment_failed', sessionId: session.id }, ip: 'webhook', userAgent: 'stripe' });
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.bankTransferInstructions = async (req, res) => {
  const invoice = await Invoice.findByPk(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  res.json({
    invoice: invoice.number,
    amount: Number(invoice.amount),
    currency: 'SGD',
    reference: invoice.number,
    bankName: process.env.BANK_NAME || 'Your Bank Name',
    accountName: process.env.BANK_ACCOUNT_NAME || 'Your Company Name',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '000000000'
  });
};

exports.confirmBankTransfer = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const reference = (req.body && req.body.reference) || `BANK-${invoice.number}`;
    const paidAt = req.body && req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ error: 'Invalid paid date' });
    }

    const data = Object.assign({}, invoice.data || {}, {
      payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
        provider: 'bank_transfer',
        method: 'BankTransfer',
        bankReference: reference,
        status: 'paid',
        paidAt: paidAt.toISOString(),
        recordedBy: req.user && req.user.id
      })
    });

    await invoice.update({ status: 'Paid', data });
    const payment = await recordPayment(invoice, {
      method: 'BankTransfer',
      amount: Number(invoice.amount),
      currency: 'SGD',
      providerReference: reference,
      paidAt,
      recordedBy: req.user && req.user.id,
      data: {
        bankReference: reference,
        note: req.body && req.body.note
      }
    });
    const { ip, userAgent } = getRequestMetadata(req);
    await logAudit({ userId: req.user ? req.user.id : null, action: 'payment_bank_transfer_confirmed', entity: 'Payment', entityId: payment.id, meta: { invoiceNumber: invoice.number, amount: invoice.amount, reference, note: req.body && req.body.note }, ip, userAgent });

    res.json({ ok: true, invoice, payment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.history = async (req, res) => {
  try {
    const payments = await Payment.findAll({ order: [['paidAt', 'DESC'], ['id', 'DESC']] });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
