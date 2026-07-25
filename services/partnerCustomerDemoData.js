const SubscriptionPlan = require('../models/SubscriptionPlan');
const PartnerCustomer = require('../models/PartnerCustomer');

const PLAN_DEFINITIONS = [
  {
    code: 'BASIC',
    name: 'Basic',
    monthlyFee: 49,
    currency: 'SGD',
    features: ['Business Listing']
  },
  {
    code: 'STANDARD',
    name: 'Standard',
    monthlyFee: 99,
    currency: 'SGD',
    features: ['Business Listing', 'Appointment Management']
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    monthlyFee: 199,
    currency: 'SGD',
    features: ['Business Listing', 'Appointment Management', 'Marketing Tools', 'Analytics']
  }
];

const DEMO_CUSTOMERS = [
  ['CUS-0001', 'Customer 1', 'Hair Salon', 'Central Singapore', 'STANDARD', '2026-01-01'],
  ['CUS-0002', 'Customer 2', 'Nail Salon', 'East Singapore', 'BASIC', '2026-01-01'],
  ['CUS-0003', 'Customer 3', 'Spa & Massage', 'Downtown Singapore', 'PREMIUM', '2026-02-01'],
  ['CUS-0004', 'Customer 4', 'Aesthetics & Facial', 'Central Singapore', 'PREMIUM', '2026-02-01'],
  ['CUS-0005', 'Customer 5', 'Hair Removal', 'East Singapore', 'STANDARD', '2026-03-01'],
  ['CUS-0006', 'Customer 6', 'Makeup Studio', 'North-East Singapore', 'BASIC', '2026-03-01'],
  ['CUS-0007', 'Customer 7', "Men's Grooming", 'Downtown Singapore', 'STANDARD', '2026-04-01'],
  ['CUS-0008', 'Customer 8', 'Fitness & Wellness', 'North Singapore', 'PREMIUM', '2026-04-01'],
  ['CUS-0009', 'Customer 9', 'Chiropractic', 'West Singapore', 'STANDARD', '2026-05-01'],
  ['CUS-0010', 'Customer 10', 'TCM', 'Central Singapore', 'BASIC', '2026-05-01']
];

async function seedSubscriptionPlans() {
  const plans = {};
  for (const definition of PLAN_DEFINITIONS) {
    const [plan] = await SubscriptionPlan.findOrCreate({
      where: { code: definition.code },
      defaults: definition
    });
    await plan.update(definition);
    plans[definition.code] = plan;
  }
  return plans;
}

async function seedPartnerCustomerDemoData() {
  const plans = await seedSubscriptionPlans();
  let created = 0;
  let updated = 0;

  for (let index = 0; index < DEMO_CUSTOMERS.length; index += 1) {
    const [customerCode, businessName, businessType, region, planCode, startDate] = DEMO_CUSTOMERS[index];
    const existing = await PartnerCustomer.findOne({ where: { customerCode } });
    const demoValues = {
      businessName,
      businessType,
      contactPerson: `Demo Contact ${String(index + 1).padStart(2, '0')}`,
      billingEmail: `customer${index + 1}@example.com`,
      phone: `+65 0000 ${String(index + 1).padStart(4, '0')}`,
      billingAddress: `Demo Business Address ${index + 1}`,
      region,
      subscriptionPlanId: plans[planCode].id,
      currency: 'SGD',
      billingCycle: 'Monthly',
      paymentTermsDays: 14,
      subscriptionStartDate: startDate,
      autoBillingEnabled: true,
      nextBillingDate: '2026-07-31',
      notes: 'Synthetic demonstration record; not a real Vaniday partner.'
    };

    if (existing) {
      await existing.update({ ...demoValues, status: 'Active' });
      updated += 1;
      continue;
    }

    await PartnerCustomer.create({ customerCode, ...demoValues, status: 'Active' });
    created += 1;
  }

  const activeCount = await PartnerCustomer.count({ where: { status: 'Active' } });
  return {
    plans: Object.keys(plans).length,
    customersCreated: created,
    customersUpdated: updated,
    activeCustomers: activeCount
  };
}

module.exports = {
  PLAN_DEFINITIONS,
  DEMO_CUSTOMERS,
  seedSubscriptionPlans,
  seedPartnerCustomerDemoData
};
