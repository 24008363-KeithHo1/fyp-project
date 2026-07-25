const test = require('node:test');
const assert = require('node:assert/strict');
const { PLAN_DEFINITIONS, DEMO_CUSTOMERS } = require('../services/partnerCustomerDemoData');

test('defines the three approved monthly subscription plans', () => {
  assert.deepEqual(
    PLAN_DEFINITIONS.map((plan) => [plan.name, plan.monthlyFee]),
    [['Basic', 49], ['Standard', 99], ['Premium', 199]]
  );
});

test('demo records use synthetic customer labels and approved plans', () => {
  assert.equal(DEMO_CUSTOMERS.length, 10);
  DEMO_CUSTOMERS.forEach((customer, index) => {
    assert.equal(customer[1], `Customer ${index + 1}`);
    assert.ok(['BASIC', 'STANDARD', 'PREMIUM'].includes(customer[4]));
  });
});
