require('dotenv').config();
const { sequelize } = require('../config/db');
require('../models/SubscriptionInvoiceItem');
require('../models/SubscriptionAutomationRun');
require('../models/SubscriptionEmailDelivery');
require('../models/SubscriptionDemoSchedule');

async function run() {
  await sequelize.authenticate();
  await sequelize.models.SubscriptionInvoice.sync();
  await sequelize.models.SubscriptionInvoiceItem.sync();
  await sequelize.models.SubscriptionAutomationRun.sync();
  await sequelize.models.SubscriptionEmailDelivery.sync();
  await sequelize.models.SubscriptionDemoSchedule.sync();
  console.log({
    tablesReady: [
      'SubscriptionInvoices',
      'SubscriptionInvoiceItems',
      'SubscriptionAutomationRuns',
      'SubscriptionEmailDeliveries',
      'SubscriptionDemoSchedules'
    ],
    invoicesCreated: 0
  });
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
