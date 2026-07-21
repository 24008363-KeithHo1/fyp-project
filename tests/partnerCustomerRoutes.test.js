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
