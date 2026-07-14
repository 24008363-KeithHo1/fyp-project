const Stripe = require('stripe');
const QRCode = require('qrcode');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const { logAudit, getRequestMetadata } = require('../utils/audit');
const { simulateRefundDestination } = require('../utils/testBank');

const paypalEnv = process.env.PAYPAL_ENV || process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || (
  paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
);
const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY || 'SGD';
const NETS_CURRENCY = 'SGD';

// Added to keep all payment providers using consistent Paid/Pending/Failed labels.
function normalizePaymentStatus(status) {
  if (!status) return 'Paid';
  const value = String(status).toLowerCase();
  if (value === 'refunded' || value === 'refund') return 'Refunded';
  if (value === 'paid' || value === 'complete' || value === 'completed' || value === 'succeeded') return 'Paid';
  if (value === 'failed' || value === 'declined') return 'Failed';
  return 'Pending';
}

function emvField(id, value) {
  const text = String(value || '');
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

function crc16Ccitt(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Added for NETS QR: decides which NETS proxy type is stored in the QR payload.
function NETSProxyType() {
  const raw = String(process.env.NETS_PROXY_TYPE || '').trim().toUpperCase();
  if (raw === 'MOBILE' || raw === 'MSISDN' || raw === '0') return '0';
  return '2';
}

// Added for NETS QR: builds the Singapore EMV payload from invoice amount and merchant settings.
function createNETSPayload(invoice) {
  const proxyValue = process.env.NETS_PROXY_VALUE || process.env.NETS_UEN || process.env.NETS_MOBILE;
  if (!proxyValue) {
    throw new Error('NETS is not configured. Set NETS_PROXY_VALUE, NETS_UEN, or NETS_MOBILE.');
  }

  const merchantName = (process.env.NETS_MERCHANT_NAME || process.env.BANK_ACCOUNT_NAME || 'FYP PROJECT').slice(0, 25);
  const reference = (invoice.number || `INV-${invoice.id}`).slice(0, 25);
  const amount = Number(invoice.amount).toFixed(2);
  const merchantAccount = [
    emvField('00', 'SG.NETS'),
    emvField('01', NETSProxyType()),
    emvField('02', String(proxyValue).trim()),
    emvField('03', '1')
  ].join('');
  const additionalData = emvField('01', reference);
  const withoutCrc = [
    emvField('00', '01'),
    emvField('01', '12'),
    emvField('26', merchantAccount),
    emvField('52', '0000'),
    emvField('53', '702'),
    emvField('54', amount),
    emvField('58', 'SG'),
    emvField('59', merchantName),
    emvField('60', 'Singapore'),
    emvField('62', additionalData),
    '6304'
  ].join('');

  return {
    payload: `${withoutCrc}${crc16Ccitt(withoutCrc)}`,
    reference,
    amount,
    merchantName
  };
}

// Added so Stripe, PayPal, NETS, bank transfer, and manual payments are saved in one history table.
async function recordPayment(invoice, paymentData) {
  const providerReference = paymentData.providerReference || `${paymentData.method}-${invoice.id}-${Date.now()}`;
  const payload = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    method: paymentData.method,
    amount: paymentData.amount || Number(invoice.amount),
    currency: paymentData.currency || 'SGD',
    status: normalizePaymentStatus(paymentData.status),
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
    providerReference: paymentData.paymentIntentId || paymentData.checkoutSessionId || paymentData.paypalCaptureId || paymentData.paypalOrderId,
    data: paymentData
  });
  return invoice;
}

function requirePayPalConfig() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }
}

async function paypalRequest(path, options = {}) {
  requirePayPalConfig();

  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const tokenResponse = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(tokenData.error_description || tokenData.error || 'Unable to authenticate with PayPal');
  }

  const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message || data.error_description || data.error || 'PayPal request failed');
  }

  return data;
}

exports.paypalConfig = (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    return res.status(500).json({ error: 'PayPal is not configured. Set PAYPAL_CLIENT_ID.' });
  }

  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID,
    currency: PAYPAL_CURRENCY
  });
};

exports.createPayPalOrder = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'Paid') return res.status(400).json({ error: 'Invoice is already paid' });
    if (!Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0) {
      return res.status(400).json({ error: 'Invoice amount must be greater than zero' });
    }

    const order = await paypalRequest('/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'PayPal-Request-Id': `invoice-${invoice.id}-${Date.now()}`
      },
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: String(invoice.id),
          invoice_id: invoice.number || String(invoice.id),
          description: `Invoice ${invoice.number || invoice.id}`,
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: Number(invoice.amount).toFixed(2)
          }
        }],
        application_context: {
          return_url: `${getBaseUrl(req)}/payment/success?invoice=${invoice.id}`,
          cancel_url: `${getBaseUrl(req)}/payment/cancel?invoice=${invoice.id}`
        }
      }
    });

    const data = Object.assign({}, invoice.data || {}, {
      payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
        provider: 'paypal',
        paypalOrderId: order.id,
        createdAt: new Date().toISOString()
      })
    });
    await invoice.update({ data });

    res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.capturePayPalOrder = async (req, res) => {
  try {
    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(req.params.orderId)}/capture`, {
      method: 'POST'
    });

    const purchaseUnit = order.purchase_units && order.purchase_units[0];
    const capture = purchaseUnit
      && purchaseUnit.payments
      && purchaseUnit.payments.captures
      && purchaseUnit.payments.captures[0];
    const invoiceId = purchaseUnit && purchaseUnit.reference_id;

    if (!invoiceId) {
      return res.status(400).json({ error: 'PayPal order is missing invoice reference' });
    }

    await markInvoicePaid(invoiceId, {
      provider: 'paypal',
      method: 'PayPal',
      paypalOrderId: order.id,
      paypalCaptureId: capture && capture.id,
      amountReceived: capture && capture.amount ? Number(capture.amount.value) : undefined,
      currency: capture && capture.amount ? capture.amount.currency_code : PAYPAL_CURRENCY,
      status: (capture && capture.status) || order.status || 'paid'
    });

    res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    if (err.name === 'SequelizeDatabaseError' && /Data truncated|PayPal|enum/i.test(err.message)) {
      return res.status(500).json({
        error: "Database needs PayPal/NETS enabled in Payments.method. Run: ALTER TABLE Payments MODIFY COLUMN method ENUM('Stripe','PayPal','NETS','BankTransfer','Manual') NOT NULL;"
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.createCheckoutSession = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.' });
    }

    const invoice = await Invoice.findByPk(req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.status === 'Paid') return res.status(400).json({ error: 'Invoice is already paid' });
    if (!Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0) {
      return res.status(400).json({ error: 'Invoice amount must be greater than zero' });
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
      success_url: `${getBaseUrl(req)}/payment/success?session_id={CHECKOUT_SESSION_ID}&invoice=${invoice.id}`,
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

exports.handleSuccess = async (req, res) => {
  const invoiceId = req.query.invoice;

  try {
    if (!stripe) {
      return res.redirect(`/finance/dashboard?payment=stripe&status=config_error${invoiceId ? `&invoice=${encodeURIComponent(invoiceId)}` : ''}`);
    }

    let sessionId = req.query.session_id;
    if (!sessionId && invoiceId) {
      const invoice = await Invoice.findByPk(invoiceId);
      sessionId = invoice && invoice.data && invoice.data.payment && invoice.data.payment.checkoutSessionId;
    }

    if (!sessionId) {
      return res.redirect(`/finance/dashboard?payment=stripe&status=missing_session${invoiceId ? `&invoice=${encodeURIComponent(invoiceId)}` : ''}`);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const resolvedInvoiceId = (session.metadata && session.metadata.invoiceId) || invoiceId;

    if (session.payment_status === 'paid' || session.status === 'complete') {
      await markInvoicePaid(resolvedInvoiceId, {
        provider: 'stripe',
        method: 'Stripe',
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent,
        amountReceived: session.amount_total ? session.amount_total / 100 : undefined,
        currency: session.currency,
        status: session.payment_status || 'paid'
      });
    }

    return res.redirect(`/finance/dashboard?payment=stripe&status=${encodeURIComponent(session.payment_status || session.status || 'complete')}${resolvedInvoiceId ? `&invoice=${encodeURIComponent(resolvedInvoiceId)}` : ''}`);
  } catch (err) {
    console.error('Stripe success handling error:', err);
    return res.redirect(`/finance/dashboard?payment=stripe&status=error${invoiceId ? `&invoice=${encodeURIComponent(invoiceId)}` : ''}`);
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

// Added for bank transfer: returns account details and invoice reference for finance users.
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

// Added for NETS QR: generates a QR image for an unpaid invoice and stores its reference.
exports.netsQr = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'Paid') return res.status(400).json({ error: 'Invoice is already paid' });
    if (!Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0) {
      return res.status(400).json({ error: 'Invoice amount must be greater than zero' });
    }

    const NETS = createNETSPayload(invoice);
    const qrDataUrl = await QRCode.toDataURL(NETS.payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280
    });

    const data = Object.assign({}, invoice.data || {}, {
      payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
        provider: 'nets',
        method: 'NETS',
        reference: NETS.reference,
        qrCreatedAt: new Date().toISOString()
      })
    });
    await invoice.update({ data });

    res.json({
      invoice: invoice.number,
      amount: Number(invoice.amount),
      currency: NETS_CURRENCY,
      reference: NETS.reference,
      merchantName: NETS.merchantName,
      qrDataUrl,
      payload: NETS.payload
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Added for finance confirmation: marks verified bank transfer or NETS payments as Paid.
exports.confirmBankTransfer = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'Paid') return res.status(400).json({ error: 'Invoice already marked as paid' });

    const reference = req.body && req.body.reference ? String(req.body.reference).trim() : '';
    if (!reference) {
      return res.status(400).json({ error: 'Bank reference is required' });
    }
    const paidAt = req.body && req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ error: 'Invalid paid date' });
    }
    if (paidAt > new Date()) {
      return res.status(400).json({ error: 'Paid date cannot be future date' });
    }

    const method = req.body && req.body.method === 'NETS' ? 'NETS' : 'BankTransfer';
    const provider = method === 'NETS' ? 'nets' : 'bank_transfer';
    const data = Object.assign({}, invoice.data || {}, {
      payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
        provider,
        method,
        bankReference: reference,
        status: 'paid',
        paidAt: paidAt.toISOString(),
        recordedBy: req.user && req.user.id
      })
    });

    await invoice.update({ status: 'Paid', data });
    const payment = await recordPayment(invoice, {
      method,
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
    await logAudit({ userId: req.user ? req.user.id : null, action: method === 'NETS' ? 'payment_nets_confirmed' : 'payment_bank_transfer_confirmed', entity: 'Payment', entityId: payment.id, meta: { invoiceNumber: invoice.number, amount: invoice.amount, reference, note: req.body && req.body.note }, ip, userAgent });

    res.json({ ok: true, invoice, payment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Added for the finance payments page: returns payment history with invoice/customer details.
exports.history = async (req, res) => {
  try {
    const payments = await Payment.findAll({ order: [['paidAt', 'DESC'], ['id', 'DESC']] });
    const invoiceIds = [...new Set(payments.map(payment => payment.invoiceId).filter(Boolean))];
    const invoices = invoiceIds.length ? await Invoice.findAll({ where: { id: invoiceIds } }) : [];
    const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));

    res.json(payments.map(payment => {
      const payload = payment.toJSON();
      const invoice = invoiceMap.get(payment.invoiceId);
      return Object.assign(payload, {
        customerName: invoice ? invoice.customer_name : '',
        invoiceStatus: invoice ? invoice.status : ''
      });
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Added for finance: marks a recorded payment as refunded and reopens the invoice.
exports.refundPayment = async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'Refunded') return res.status(400).json({ error: 'Payment is already refunded' });
    if (payment.status !== 'Paid') return res.status(400).json({ error: 'Only paid payments can be refunded' });

    const invoice = await Invoice.findByPk(payment.invoiceId);
    const refundedAt = new Date();
    const reason = req.body && req.body.reason ? String(req.body.reason).trim() : '';
    const refundDestination = await simulateRefundDestination({
      payment,
      invoice,
      refundedBy: req.user && req.user.id
    });
    const refundReference = req.body && req.body.refundReference
      ? String(req.body.refundReference).trim()
      : refundDestination.transaction.reference;
    const refundData = {
      refundReference,
      reason,
      refundedAt: refundedAt.toISOString(),
      refundedBy: req.user && req.user.id,
      testBankAccountId: refundDestination.refundAccount.id,
      testBankAccountNumber: refundDestination.refundAccount.accountNumber,
      testBankTransactionId: refundDestination.transaction.id,
      testBankReference: refundDestination.transaction.reference
    };

    await payment.update({
      status: 'Refunded',
      data: Object.assign({}, payment.data || {}, { refund: refundData })
    });

    if (invoice) {
      const invoiceData = Object.assign({}, invoice.data || {}, {
        payment: Object.assign({}, (invoice.data && invoice.data.payment) || {}, {
          status: 'refunded',
          refundedAt: refundedAt.toISOString(),
        refundReference,
        refundReason: reason,
        refundTestBankAccount: refundDestination.refundAccount.accountNumber
      })
      });
      await invoice.update({ status: 'Sent', data: invoiceData });
    }

    const { ip, userAgent } = getRequestMetadata(req);
    await logAudit({
      userId: req.user ? req.user.id : null,
      action: 'payment_refunded',
      entity: 'Payment',
      entityId: payment.id,
      meta: {
        invoiceNumber: payment.invoiceNumber,
        amount: payment.amount,
        method: payment.method,
        refundReference,
        reason,
        testBankAccountId: refundDestination.refundAccount.id,
        testBankAccountNumber: refundDestination.refundAccount.accountNumber,
        testBankTransactionId: refundDestination.transaction.id
      },
      ip,
      userAgent
    });

    res.json({ ok: true, payment, invoice, refundDestination });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
