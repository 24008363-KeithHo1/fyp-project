const { QueryTypes } = require('sequelize');

async function tableExists(sequelize, table) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function addColumnIfMissing(sequelize, table, column, definition) {
  if (!(await tableExists(sequelize, table)) || (await columnExists(sequelize, table, column))) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

module.exports.up = async ({ sequelize }) => {
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'remarks', 'TEXT NULL AFTER reason');
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'supplierEmail', "VARCHAR(255) NULL AFTER currency");
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'notificationEmail', 'VARCHAR(255) NULL AFTER returnTransactionId');
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'notificationStatus', "ENUM('Pending','Sent','Failed') NOT NULL DEFAULT 'Pending' AFTER notificationEmail");
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'notificationSentAt', 'DATETIME NULL AFTER notificationStatus');
  await addColumnIfMissing(sequelize, 'PaymentReturns', 'notificationError', 'TEXT NULL AFTER notificationSentAt');

  await sequelize.query(`
    UPDATE PaymentReturns
    SET supplierEmail = COALESCE(notificationEmail, JSON_UNQUOTE(JSON_EXTRACT(data, '$.recipientPaypalEmail')), '')
    WHERE supplierEmail IS NULL
  `);
  await sequelize.query(`ALTER TABLE PaymentReturns MODIFY COLUMN supplierEmail VARCHAR(255) NOT NULL`);
};
