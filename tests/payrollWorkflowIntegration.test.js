const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('restricts payroll file imports to HR and Admin', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'payroll.js'), 'utf8');
  assert.match(routes, /router\.post\('\/upload', auth, checkRole\(\['Admin','HR'\]\)/);
  assert.doesNotMatch(routes, /router\.post\('\/upload'.*Finance/);
});

test('exposes active payroll workflow state and disables unavailable imports in the UI', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'payroll.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'controllers', 'payrollController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'payroll.ejs'), 'utf8');
  assert.match(routes, /router\.get\('\/active-period'/);
  assert.match(controller, /exports\.activePeriod/);
  assert.match(controller, /roleCanImport/);
  assert.match(view, /loadActivePeriod/);
  assert.match(view, /only HR or Admin can import payroll files/);
  assert.match(view, /importPayrollButton\.disabled = !payrollImportAllowed/);
});

test('links payroll records to a payroll period', () => {
  const Payroll = require('../models/Payroll');
  assert.ok(Payroll.rawAttributes.payrollPeriodId);
  assert.equal(Payroll.rawAttributes.payrollPeriodId.allowNull, true);
  assert.equal(
    Payroll.options.indexes.some((index) => index.fields && index.fields.includes('payrollPeriodId')),
    false,
    'the startup schema bootstrap must create this index after adding the legacy-table column'
  );
});

test('uses an explicit submit-to-Finance transition instead of generic advancement routes', () => {
  const adminRoutes = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  const hrRoutes = fs.readFileSync(path.join(root, 'routes', 'hr.js'), 'utf8');
  assert.match(hrRoutes, /period\/:id\/submit/);
  assert.doesNotMatch(adminRoutes, /automation/);
  assert.doesNotMatch(hrRoutes, /period\/:id\/advance/);
  assert.match(hrRoutes, /period\/:id\/close/);
});

test('provides Finance batch approval and request-changes routes', () => {
  const routes = fs.readFileSync(path.join(root, 'routes', 'finance.js'), 'utf8');
  assert.match(routes, /payroll-approvals\/:id\/approve/);
  assert.match(routes, /payroll-approvals\/:id\/reject/);
  assert.match(routes, /requireRole\(\['Admin', 'Finance'\]\)/);
});

test('summarizes a submitted payroll batch for Finance review', () => {
  const { summarize } = require('../controllers/payrollApprovalController');
  const records = [
    { gross: 3000, deductions: { cpf: 300 }, net: 2700 },
    { gross: 2500, deductions: { cpf: 250, other: 50 }, net: 2200 }
  ];
  assert.deepEqual(summarize(records), {
    employeeCount: 2,
    paidCount: 0,
    gross: 5500,
    deductions: 600,
    net: 4900
  });
});
