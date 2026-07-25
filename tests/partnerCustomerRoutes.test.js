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

test('subscription invoice review UI exposes edit, rejection and approval but not sending', () => {
  const view = fs.readFileSync(path.join(root, 'views', 'finance', 'subscription-invoices.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes', 'subscriptionInvoices.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'subscriptionInvoiceController.js'), 'utf8');
  assert.match(view, /Draft review stage/);
  assert.match(view, /saveDraftChanges/);
  assert.match(view, /confirmRejectDraft/);
  assert.match(view, /approveDraft/);
  assert.match(routes, /router\.patch\('\/:id\/draft'/);
  assert.match(routes, /router\.post\('\/:id\/reject'/);
  assert.match(routes, /router\.post\('\/:id\/approve'/);
  assert.match(routes, /router\.get\('\/:id\/pdf'/);
  assert.match(controller, /approvedBy:\s*req\.user\.id/);
  assert.match(controller, /No email has been sent yet/);
  assert.match(controller, /PDF preview is available only after Finance approval/);
  assert.match(view, /downloadSubscriptionPdf/);
  assert.doesNotMatch(view, /data-send-id|sendInvoice|approveAndSend/);
});
