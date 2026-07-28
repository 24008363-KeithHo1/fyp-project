const { QueryTypes } = require('sequelize');

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function up({ sequelize }) {
  if (!(await columnExists(sequelize, 'SubscriptionPayments', 'provider'))) {
    throw new Error('SubscriptionPayments.provider must exist before enabling bank transfers.');
  }
  await sequelize.query(
    "ALTER TABLE SubscriptionPayments MODIFY COLUMN provider ENUM('Stripe','BankTransfer') NOT NULL DEFAULT 'Stripe'"
  );
}

module.exports = { up };
