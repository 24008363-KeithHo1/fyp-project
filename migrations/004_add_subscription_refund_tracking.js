const { QueryTypes } = require('sequelize');

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function addColumn(sequelize, name, definition) {
  if (!(await columnExists(sequelize, 'SubscriptionPayments', name))) {
    await sequelize.query(`ALTER TABLE SubscriptionPayments ADD COLUMN \`${name}\` ${definition}`);
  }
}

async function up({ sequelize }) {
  await addColumn(sequelize, 'refundedAt', 'DATETIME NULL');
  await addColumn(sequelize, 'refundReference', 'VARCHAR(255) NULL UNIQUE');
  await addColumn(sequelize, 'refundAmount', 'DECIMAL(10,2) NULL');
  await addColumn(sequelize, 'refundReason', 'TEXT NULL');
}

module.exports = { up };
