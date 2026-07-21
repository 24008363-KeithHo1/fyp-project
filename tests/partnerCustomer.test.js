const assert = require('assert');
const PartnerCustomer = require('../models/PartnerCustomer');

async function run() {
  const customer = PartnerCustomer.build({
    customerCode: 'CUS-001',
    businessName: 'Customer 1',
    businessType: 'Hair Salon',
    contactPerson: 'Contact Person 1',
    billingEmail: 'customer1@example.com',
    subscriptionStartDate: '2026-07-01'
  });

  await customer.validate();
  assert.strictEqual(customer.currency, 'SGD');
  assert.strictEqual(customer.billingCycle, 'Monthly');
  assert.strictEqual(customer.paymentTermsDays, 14);
  assert.strictEqual(customer.status, 'Active');

  const invalidCustomer = PartnerCustomer.build({
    customerCode: 'CUS-002',
    businessName: 'Customer 2',
    businessType: 'Nail Salon',
    contactPerson: 'Contact Person 2',
    billingEmail: 'not-an-email',
    subscriptionStartDate: '2026-07-01'
  });

  await assert.rejects(() => invalidCustomer.validate(), /Validation isEmail on billingEmail failed/);
  console.log('PartnerCustomer model tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
