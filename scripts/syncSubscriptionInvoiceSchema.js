require('dotenv').config();
const { sequelize } = require('../config/db');
require('../models/SubscriptionInvoiceItem');

async function run() {
  await sequelize.authenticate();
  await sequelize.models.SubscriptionInvoice.sync();
  await sequelize.models.SubscriptionInvoiceItem.sync();
  console.log({
    tablesReady: ['SubscriptionInvoices', 'SubscriptionInvoiceItems'],
    invoicesCreated: 0
  });
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
