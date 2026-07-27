require('dotenv').config();
const { sequelize } = require('../config/db');
require('../models/PartnerCustomer');
const { seedPartnerCustomerDemoData } = require('../services/partnerCustomerDemoData');

async function run() {
  await sequelize.authenticate();
  const result = await seedPartnerCustomerDemoData();
  console.log(result);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
