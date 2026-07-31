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

module.exports.up = async ({ sequelize }) => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS PaymentReturns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      originalPaymentId INT NOT NULL,
      invoiceId INT NOT NULL,
      reason TEXT NOT NULL,
      remarks TEXT,
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'SGD',
      supplierEmail VARCHAR(255) NOT NULL,
      requestedBy INT,
      requestedAt DATETIME NOT NULL,
      status ENUM('ReturnRequested','Returned') NOT NULL DEFAULT 'ReturnRequested',
      confirmedBy INT,
      confirmedAt DATETIME,
      returnTransactionId INT,
      notificationEmail VARCHAR(255),
      notificationStatus ENUM('Pending','Sent','Failed') NOT NULL DEFAULT 'Pending',
      notificationSentAt DATETIME,
      notificationError TEXT,
      data JSON,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_payment_return_original_payment (originalPaymentId),
      INDEX idx_payment_returns_invoice_status (invoiceId, status),
      CONSTRAINT fk_payment_return_original_payment FOREIGN KEY (originalPaymentId) REFERENCES Payments(id),
      CONSTRAINT fk_payment_return_invoice FOREIGN KEY (invoiceId) REFERENCES Invoices(id),
      CONSTRAINT fk_payment_return_requested_by FOREIGN KEY (requestedBy) REFERENCES Users(id) ON DELETE SET NULL,
      CONSTRAINT fk_payment_return_confirmed_by FOREIGN KEY (confirmedBy) REFERENCES Users(id) ON DELETE SET NULL,
      CONSTRAINT fk_payment_return_transaction FOREIGN KEY (returnTransactionId) REFERENCES TestBankTransactions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureEnum(
    sequelize,
    'TestBankTransactions',
    'type',
    ['SalaryRelease', 'Refund', 'Adjustment', 'SupplierPayment', 'InvoicePayment', 'PaymentReversal', 'PaymentReturn'],
    null,
    false
  );
};
