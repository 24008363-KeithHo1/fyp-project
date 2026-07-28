const { QueryTypes } = require('sequelize');

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function indexExists(sequelize, table, index) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
    { replacements: [table, index], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function up({ sequelize }) {
  if (!(await columnExists(sequelize, 'SubscriptionEmailDeliveries', 'reminderKey'))) {
    await sequelize.query(
      'ALTER TABLE SubscriptionEmailDeliveries ADD COLUMN reminderKey VARCHAR(80) NULL AFTER emailType'
    );
  }
  if (!(await indexExists(sequelize, 'SubscriptionEmailDeliveries', 'subscription_reminder_milestone_unique'))) {
    await sequelize.query(`
      CREATE UNIQUE INDEX subscription_reminder_milestone_unique
      ON SubscriptionEmailDeliveries (subscriptionInvoiceId, emailType, reminderKey)
    `);
  }
}

module.exports = { up };
