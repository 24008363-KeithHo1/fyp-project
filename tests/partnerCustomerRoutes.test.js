const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('partner customer module remains separate from existing invoice models', () => {
  const model = fs.readFileSync(path.join(root, 'models', 'PartnerCustomer.js'), 'utf8');
  assert.doesNotMatch(model, /require\(['"]\.\/Invoice/);
  assert.doesNotMatch(model, /invoiceId/);
});

test('partner customer API is restricted to Admin', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'partnerCustomers.js'), 'utf8');
  assert.match(routes, /requireRole\(\['Admin'\]\)/);
  assert.match(routes, /router\.patch\('\/:id\/status'/);
});

test('subscription draft generation API is separate and restricted to Finance', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  assert.match(routes, /requireRole\(\['Finance'\]\)/);
  assert.doesNotMatch(routes, /requireRole\(\['Admin'\]\)/);
  assert.match(routes, /generation-preview/);
  assert.match(routes, /generate-drafts/);
  assert.match(routes, /automation-runs/);
  assert.doesNotMatch(routes, /invoiceController/);
});

test('Finance partner access is limited to billing routes', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'partnerCustomers.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'partnerCustomerController.js'), 'utf8');
  assert.match(routes, /router\.get\('\/billing', requireRole\(\['Finance'\]\)/);
  assert.match(routes, /router\.patch\('\/:id\/billing', requireRole\(\['Finance'\]\)/);
  assert.match(routes, /requireRole\(\['Admin', 'Finance'\]\), controller\.plans/);
  assert.match(controller, /Finance can edit billing settings only/);
  assert.match(controller, /const allowedFields = \[[\s\S]*?'subscriptionPlanId'[\s\S]*?'paymentTermsDays'[\s\S]*?'autoBillingEnabled'[\s\S]*?'nextBillingDate'/);
});

test('subscription invoice review page is explicitly Finance-only', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'finance.js'), 'utf8');
  assert.match(
    routes,
    /router\.get\('\/subscription-invoices', requireRole\(\['Finance'\]\), subscriptionInvoices\.reviewPage\)/
  );
});

test('subscription invoice review UI exposes the Finance approval and sending workflow', () => {
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionInvoiceController.js'), 'utf8');
  assert.match(view, /Review, approve and send/);
  assert.match(view, /saveDraftChanges/);
  assert.match(view, /confirmRejectDraft/);
  assert.match(view, /approveDraft/);
  assert.match(routes, /router\.patch\('\/:id\/draft'/);
  assert.match(routes, /router\.post\('\/:id\/reject'/);
  assert.match(routes, /router\.post\('\/:id\/approve'/);
  assert.match(routes, /router\.post\('\/:id\/send'/);
  assert.match(routes, /router\.get\('\/:id\/pdf'/);
  assert.match(controller, /approvedBy:\s*req\.user\.id/);
  assert.match(controller, /No email has been sent yet/);
  assert.match(controller, /PDF preview is available only after Finance approval/);
  assert.match(view, /downloadSubscriptionPdf/);
  assert.match(view, /sendSubscriptionInvoice/);
  assert.match(controller, /sendSubscriptionInvoiceEmail/);
  assert.match(controller, /status:\s*'Sent',\s*sentAt:/);
  assert.match(controller, /invoice remains Approved and can be retried/);
});

test('subscription customer view uses its own secure token route', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionInvoiceController.js'), 'utf8');
  assert.match(app, /\/subscription-invoices\/view\/:token/);
  assert.match(controller, /where:\s*\{\s*publicToken:\s*req\.params\.token\s*\}/);
  assert.match(controller, /invoice\.status === 'Sent'/);
  assert.doesNotMatch(controller, /models\/Invoice|models\/Payment/);
});

test('Finance has isolated immediate and scheduled demo generation controls', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  const scheduler = fs.readFileSync(path.join(root, 'services', 'subscriptionInvoiceDemoScheduler.js'), 'utf8');
  assert.match(routes, /router\.post\('\/demo-generate'/);
  assert.match(routes, /router\.post\('\/demo-schedules'/);
  assert.match(routes, /router\.get\('\/demo-schedules'/);
  assert.match(view, /Finance demo generation/);
  assert.match(view, /Generate now/);
  assert.match(view, /Singapore time \(SGT\)/);
  assert.match(scheduler, /demo-subscription-invoices:scheduled:/);
  assert.doesNotMatch(scheduler, /models\/Invoice|models\/Payment/);
});

test('Finance can monitor the separate subscription payment ledger', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionInvoiceController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.get\('\/payments', controller\.paymentHistory\)/);
  assert.match(controller, /exports\.paymentHistory/);
  assert.match(controller, /'providerReference'[\s\S]*?'failureReason'/);
  assert.doesNotMatch(controller, /paymentHistory[\s\S]*checkoutSessionId/);
  assert.match(view, /Subscription payment tracking/);
  assert.match(view, /paymentStatusFilter/);
  assert.match(view, /Payment attempts/);
});

test('Finance can preview and run the isolated subscription overdue check', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.get\('\/overdue-preview', controller\.overduePreview\)/);
  assert.match(routes, /router\.post\('\/overdue-check', controller\.runOverdueCheck\)/);
  assert.match(view, /runOverdueCheck/);
  assert.match(view, /Check overdue/);
});

test('Finance controls milestone-based subscription overdue reminders', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.get\('\/reminder-preview', controller\.reminderPreview\)/);
  assert.match(routes, /router\.post\('\/send-reminders', controller\.sendReminders\)/);
  assert.match(view, /Send due reminders/);
  assert.match(view, /loadReminderPreview/);
});

test('subscription reminder scheduler is started independently from other automation', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /startSubscriptionReminderScheduler/);
  assert.match(app, /startSubscriptionOverdueScheduler\(\);[\s\S]*startSubscriptionReminderScheduler\(\);/);
});

test('Finance can reconcile pending subscription payments with Stripe sandbox', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const paymentController = fs.readFileSync(path.join(root, 'controllers', 'subscriptionPaymentController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.post\('\/payments\/:paymentId\/reconcile'/);
  assert.match(paymentController, /exports\.reconcileStripePayment/);
  assert.match(paymentController, /Only Pending or Failed Stripe subscription payments can be reconciled/);
  assert.match(view, /data-reconcile-payment-id/);
  assert.match(view, /reconcileSubscriptionPayment/);
});

test('Finance can issue a guarded full Stripe sandbox refund', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const paymentController = fs.readFileSync(path.join(root, 'controllers', 'subscriptionPaymentController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.post\('\/payments\/:paymentId\/refund'/);
  assert.match(paymentController, /exports\.refundStripePayment/);
  assert.match(paymentController, /idempotencyKey:\s*`subscription-refund-/);
  assert.match(paymentController, /refund\.status !== 'succeeded'/);
  assert.match(view, /data-refund-payment-id/);
  assert.match(view, /refundSubscriptionPayment/);
});

test('paid subscription receipts have separate customer and Finance routes', () => {
  const financeRoutes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const publicRoutes = fs.readFileSync(path.join(root, 'routes', 'subscriptionPayments.js'), 'utf8');
  const customerView = fs.readFileSync(path.join(root, 'views', 'subscription-invoices', 'view.ejs'), 'utf8');
  const financeView = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(publicRoutes, /router\.get\('\/:token\/receipt', controller\.publicReceipt\)/);
  assert.match(financeRoutes, /router\.get\('\/payments\/:paymentId\/receipt'/);
  assert.match(customerView, /Download payment receipt/);
  assert.match(financeView, /fa-receipt/);
});

test('all confirmed Stripe paths trigger duplicate-safe subscription receipt email', () => {
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionPaymentController.js'), 'utf8');
  const model = fs.readFileSync(path.join(root, 'models', 'SubscriptionEmailDelivery.js'), 'utf8');
  assert.match(controller, /sendSubscriptionPaymentConfirmation/);
  assert.ok((controller.match(/deliverPaymentConfirmation\(req, result\.invoice, result\.payment\)/g) || []).length >= 3);
  assert.match(model, /DataTypes\.ENUM\('Invoice', 'Reminder', 'Receipt'\)/);
});

test('Finance has a separate subscription revenue report and CSV export', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.get\('\/revenue-report', controller\.revenueReport\)/);
  assert.match(routes, /router\.get\('\/revenue-export\.csv', controller\.revenueExport\)/);
  assert.match(view, /Subscription revenue report/);
  assert.match(view, /exportRevenueCsv/);
  assert.match(view, /Net revenue/);
});

test('Finance can record guarded subscription bank transfers', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionPaymentController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  assert.match(routes, /router\.post\('\/payments\/bank-transfer', subscriptionPaymentController\.recordBankTransfer\)/);
  assert.match(controller, /recordSubscriptionBankTransfer/);
  assert.match(controller, /subscription_bank_transfer_recorded/);
  assert.match(view, /Record bank transfer/);
  assert.match(view, /recordBankTransfer/);
});
