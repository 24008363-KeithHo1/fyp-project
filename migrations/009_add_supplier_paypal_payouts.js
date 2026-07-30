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
  if (await tableExists(sequelize, table) && !(await columnExists(sequelize, table, column))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureEnum(sequelize, table, column, allowedValues, defaultValue = null, allowNull = true) {
  if (!(await tableExists(sequelize, table)) || !(await columnExists(sequelize, table, column))) return;
  const placeholders = allowedValues.map(() => '?').join(', ');
  const invalidRows = await sequelize.query(
    `SELECT DISTINCT \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` IS NOT NULL AND \`${column}\` NOT IN (${placeholders})`,
    { replacements: allowedValues, type: QueryTypes.SELECT }
  );
  if (invalidRows.length > 0) {
    throw new Error(`Cannot normalize ${table}.${column}; unsupported value(s): ${invalidRows.map((row) => row.value).join(', ')}`);
  }
  const valuesSql = allowedValues.map((value) => `'${value.replace(/'/g, "''")}'`).join(',');
  await sequelize.query(
    `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${valuesSql}) ${allowNull ? 'NULL' : 'NOT NULL'} ` +
    (defaultValue === null ? '' : `DEFAULT '${defaultValue.replace(/'/g, "''")}'`)
  );
}

async function ensureIndex(sequelize, table, name, columns, unique = false) {
  if (!(await tableExists(sequelize, table))) return;
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    { replacements: [table, name], type: QueryTypes.SELECT }
  );
  if (rows.length > 0) return;
  await sequelize.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` ON \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')})`);
}

module.exports.up = async ({ sequelize }) => {
  // Adds the minimum schema support for outgoing supplier PayPal Payouts:
  // supplier PayPal email on invoices, Approved invoice status, Supplier test
  // bank accounts, and SupplierPayment test bank transactions.
  await addColumnIfMissing(sequelize, 'Invoices', 'paypalEmail', 'VARCHAR(255) NULL AFTER `customer_name`');
  await ensureEnum(sequelize, 'Invoices', 'status', ['Draft', 'Approved', 'Sent', 'Viewed', 'Paid', 'Overdue'], 'Draft');
  await ensureEnum(sequelize, 'TestBankAccounts', 'ownerType', ['Company', 'Employee', 'Customer', 'Supplier'], null, false);
  await ensureEnum(
    sequelize,
    'TestBankTransactions',
    'type',
    ['SalaryRelease', 'Refund', 'Adjustment', 'SupplierPayment', 'InvoicePayment', 'PaymentReversal'],
    null,
    false
  );
  await ensureIndex(sequelize, 'Invoices', 'idx_invoices_paypal_email', ['paypalEmail']);
  await ensureIndex(sequelize, 'Payments', 'idx_payments_invoice_method_status', ['invoiceId', 'method', 'status']);
};
