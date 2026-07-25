require('dotenv').config();
const { sequelize } = require('../config/db');
require('../models/SubscriptionInvoiceItem');
const { previewSubscriptionInvoiceGeneration } = require('../services/subscriptionInvoiceGeneration');

async function run() {
  const period = process.argv[2] || '2026-07';
  await sequelize.authenticate();
  const preview = await previewSubscriptionInvoiceGeneration(period);
  console.log(JSON.stringify(preview, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
