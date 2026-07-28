const { QueryTypes } = require('sequelize');

async function up({ sequelize }) {
  const rows = await sequelize.query(
    `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='SubscriptionEmailDeliveries'
        AND COLUMN_NAME='emailType'
      LIMIT 1`,
    { type: QueryTypes.SELECT }
  );
  if (!rows.length) throw new Error('SubscriptionEmailDeliveries.emailType does not exist.');
  if (!rows[0].COLUMN_TYPE.includes("'Receipt'")) {
    await sequelize.query(`
      ALTER TABLE SubscriptionEmailDeliveries
      MODIFY COLUMN emailType ENUM('Invoice','Reminder','Receipt') NOT NULL DEFAULT 'Invoice'
    `);
  }
}

module.exports = { up };
