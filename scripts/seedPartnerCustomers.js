require('dotenv').config();
const { sequelize } = require('../config/db');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const PartnerCustomer = require('../models/PartnerCustomer');
const { seedPartnerCustomerDemoData } = require('../services/partnerCustomerDemoData');

async function run() {
  await sequelize.authenticate();
  await SubscriptionPlan.sync();
  await PartnerCustomer.sync();
  const [columns] = await sequelize.query("SHOW COLUMNS FROM `PartnerCustomers` LIKE 'subscriptionPlanId'");
  if (columns.length === 0) {
    await sequelize.query("ALTER TABLE `PartnerCustomers` ADD COLUMN `subscriptionPlanId` INTEGER NULL AFTER `region`");
  }
  const [basicPlan] = await SubscriptionPlan.findOrCreate({
    where: { code: 'BASIC' },
    defaults: {
      name: 'Basic',
      monthlyFee: 49,
      currency: 'SGD',
      features: ['Business Listing'],
      isActive: true
    }
  });
  await sequelize.query(
    "UPDATE `PartnerCustomers` SET `subscriptionPlanId` = :basicPlanId WHERE `subscriptionPlanId` IS NULL",
    { replacements: { basicPlanId: basicPlan.id } }
  );
  await sequelize.query("ALTER TABLE `PartnerCustomers` MODIFY COLUMN `subscriptionPlanId` INTEGER NOT NULL");
  const result = await seedPartnerCustomerDemoData();
  console.log(result);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
