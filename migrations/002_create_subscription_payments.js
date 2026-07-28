const { QueryTypes } = require('sequelize');

async function tableExists(sequelize, table) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function up({ sequelize }) {
  if (!(await tableExists(sequelize, 'SubscriptionInvoices'))) {
    throw new Error('SubscriptionInvoices must exist before creating SubscriptionPayments.');
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SubscriptionPayments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      subscriptionInvoiceId INT NOT NULL,
      provider ENUM('Stripe') NOT NULL DEFAULT 'Stripe',
      status ENUM('Pending','Paid','Failed','Refunded') NOT NULL DEFAULT 'Pending',
      expectedAmount DECIMAL(10,2) NOT NULL,
      receivedAmount DECIMAL(10,2),
      currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
      invoicePaymentKey VARCHAR(80) UNIQUE,
      checkoutSessionId VARCHAR(255) UNIQUE,
      providerReference VARCHAR(255) UNIQUE,
      attemptedAt DATETIME NOT NULL,
      paidAt DATETIME,
      failedAt DATETIME,
      failureReason TEXT,
      data JSON,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_subscription_payment_invoice
        FOREIGN KEY (subscriptionInvoiceId) REFERENCES SubscriptionInvoices(id) ON DELETE RESTRICT,
      INDEX idx_subscription_payment_invoice_status (subscriptionInvoiceId, status),
      INDEX idx_subscription_payment_provider_attempt (provider, attemptedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { up };
