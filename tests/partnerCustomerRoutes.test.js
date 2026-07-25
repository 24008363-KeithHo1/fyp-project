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
