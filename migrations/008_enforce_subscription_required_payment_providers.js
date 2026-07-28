const { QueryTypes } = require('sequelize');

async function up({ sequelize }) {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS count FROM SubscriptionPayments
      WHERE provider NOT IN ('Stripe','BankTransfer')`,
    { type: QueryTypes.SELECT }
  );
  if (Number(rows[0] && rows[0].count) > 0) {
    throw new Error('Unsupported SubscriptionPayments must be resolved before enforcing required providers.');
  }
  await sequelize.query(
    "ALTER TABLE SubscriptionPayments MODIFY COLUMN provider ENUM('Stripe','BankTransfer') NOT NULL DEFAULT 'Stripe'"
  );
}

module.exports = { up };
