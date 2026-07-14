const TestBankAccount = require('../models/TestBankAccount');
const TestBankTransaction = require('../models/TestBankTransaction');
const { ensureCompanyAccount } = require('../utils/testBank');
const { sequelize } = require('../config/db');

(async () => {
  await TestBankAccount.sync();
  await TestBankTransaction.sync();
  await ensureCompanyAccount();
  console.log('Test bank simulation tables are ready');
  await sequelize.close();
})().catch(async (err) => {
  console.error(err.message);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
