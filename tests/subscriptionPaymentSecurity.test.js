const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('subscription webhook uses raw body and its own endpoint secret', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const controller = fs.readFileSync(
    path.join(root, 'controllers', 'subscriptionPaymentController.js'),
    'utf8'
  );
  assert.match(
    app,
    /app\.post\('\/subscription-payment\/webhook', express\.raw\(\{ type: 'application\/json' \}\)/
  );
  assert.match(controller, /process\.env\.SUBSCRIPTION_STRIPE_WEBHOOK_SECRET/);
  const webhook = controller.slice(controller.indexOf('exports.stripeWebhook'), controller.indexOf('exports.reconcileStripePayment'));
  assert.doesNotMatch(webhook, /process\.env\.STRIPE_WEBHOOK_SECRET/);
  assert.match(webhook, /stripe\.webhooks\.constructEvent/);
  assert.match(webhook, /metadata\.module !== 'subscription_invoice'/);
});

test('public invoice, receipt and checkout routes are rate limited', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionPayments.js'), 'utf8');
  const security = fs.readFileSync(
    path.join(root, 'middlewares', 'subscriptionPaymentSecurity.js'),
    'utf8'
  );
  assert.match(app, /subscription-invoices\/view\/:token', publicInvoiceLimiter/);
  assert.match(routes, /:token\/receipt', publicInvoiceLimiter/);
  assert.match(routes, /:token\/stripe-checkout', checkoutLimiter/);
  assert.match(security, /limit: 10/);
});

test('Finance mutation routes retain authentication and Finance authorization', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  assert.match(routes, /router\.use\(auth\)/);
  assert.match(routes, /router\.use\(requireRole\(\['Finance'\]\)\)/);
  assert.match(routes, /router\.post\('\/payments\/bank-transfer'/);
  assert.match(routes, /router\.post\('\/payments\/:paymentId\/reconcile'/);
});

test('subscription webhook rejects an invalid Stripe signature', async () => {
  process.env.SUBSCRIPTION_STRIPE_WEBHOOK_SECRET = 'whsec_subscription_test_only';
  const controllerPath = require.resolve('../controllers/subscriptionPaymentController');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  let statusCode;
  let responseBody;
  const req = {
    body: Buffer.from('{"type":"checkout.session.completed"}'),
    headers: { 'stripe-signature': 'invalid-signature' }
  };
  const res = {
    status(code) { statusCode = code; return this; },
    send(value) { responseBody = value; return this; }
  };
  await controller.stripeWebhook(req, res);
  assert.equal(statusCode, 400);
  assert.match(responseBody, /Webhook error/);
});
