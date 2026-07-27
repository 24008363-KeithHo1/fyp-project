const { QueryTypes } = require('sequelize');

async function tableExists(sequelize, table) {
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function columnExists(sequelize, table, column) {
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function addColumnIfMissing(sequelize, table, column, definition) {
  if (await tableExists(sequelize, table) && !(await columnExists(sequelize, table, column))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function constraintExists(sequelize, name) {
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?
      LIMIT 1`,
    { replacements: [name], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function foreignKeyExists(sequelize, table, column, parentTable, parentColumn) {
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME = ?
        AND REFERENCED_COLUMN_NAME = ?
      LIMIT 1`,
    {
      replacements: [table, column, parentTable, parentColumn],
      type: QueryTypes.SELECT
    }
  );
  return rows.length > 0;
}

async function assertNoOrphans(sequelize, relationship) {
  const { table, column, parentTable, parentColumn = 'id' } = relationship;
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS count
       FROM \`${table}\` child
       LEFT JOIN \`${parentTable}\` parent
         ON parent.\`${parentColumn}\` = child.\`${column}\`
      WHERE child.\`${column}\` IS NOT NULL
        AND parent.\`${parentColumn}\` IS NULL`,
    { type: QueryTypes.SELECT }
  );
  if (Number(row.count) > 0) {
    throw new Error(
      `Cannot add ${relationship.name}: ${table}.${column} has ${row.count} orphaned row(s). ` +
      'Correct those rows and run the migration again.'
    );
  }
}

async function addForeignKey(sequelize, relationship) {
  const { name, table, column, parentTable, parentColumn = 'id', onDelete = 'RESTRICT' } = relationship;
  if (
    await constraintExists(sequelize, name) ||
    await foreignKeyExists(sequelize, table, column, parentTable, parentColumn) ||
    !(await tableExists(sequelize, table)) ||
    !(await tableExists(sequelize, parentTable)) ||
    !(await columnExists(sequelize, table, column))
  ) {
    return;
  }

  await assertNoOrphans(sequelize, relationship);
  await sequelize.query(
    `ALTER TABLE \`${table}\`
       ADD CONSTRAINT \`${name}\`
       FOREIGN KEY (\`${column}\`) REFERENCES \`${parentTable}\` (\`${parentColumn}\`)
       ON DELETE ${onDelete} ON UPDATE CASCADE`
  );
}

async function removeDuplicateProviderReferenceIndexes(sequelize) {
  if (!(await tableExists(sequelize, 'Payments'))) return;

  const rows = await sequelize.query(
    `SELECT INDEX_NAME, NON_UNIQUE,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Payments'
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME`,
    { type: QueryTypes.SELECT }
  );

  const matchingIndexes = rows.filter((row) =>
    Number(row.NON_UNIQUE) === 0 && row.columnsList === 'providerReference'
  );
  const retainedIndex = matchingIndexes.find((row) => row.INDEX_NAME === 'providerReference') ||
    matchingIndexes[0];
  const duplicateNames = matchingIndexes
    .filter((row) => row.INDEX_NAME !== retainedIndex?.INDEX_NAME)
    .map((row) => row.INDEX_NAME);

  for (const indexName of duplicateNames) {
    await sequelize.query(`ALTER TABLE \`Payments\` DROP INDEX \`${indexName.replace(/`/g, '``')}\``);
  }
}

async function ensureIndex(sequelize, table, name, columns, unique = false) {
  if (!(await tableExists(sequelize, table))) return;
  const rows = await sequelize.query(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    { replacements: [table, name], type: QueryTypes.SELECT }
  );
  if (rows.length > 0) return;
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  await sequelize.query(
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` ON \`${table}\` (${columnSql})`
  );
}

async function ensureEnum(sequelize, table, column, allowedValues, defaultValue = null, allowNull = true) {
  if (!(await tableExists(sequelize, table)) || !(await columnExists(sequelize, table, column))) return;
  const placeholders = allowedValues.map(() => '?').join(', ');
  const invalidRows = await sequelize.query(
    `SELECT DISTINCT \`${column}\` AS value
       FROM \`${table}\`
      WHERE \`${column}\` IS NOT NULL AND \`${column}\` NOT IN (${placeholders})`,
    { replacements: allowedValues, type: QueryTypes.SELECT }
  );
  if (invalidRows.length > 0) {
    throw new Error(
      `Cannot normalize ${table}.${column}; unsupported value(s): ` +
      invalidRows.map((row) => row.value).join(', ')
    );
  }
  const valuesSql = allowedValues
    .map((value) => `'${value.replace(/'/g, "''")}'`)
    .join(',');
  await sequelize.query(
    `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${valuesSql}) ` +
    `${allowNull ? 'NULL' : 'NOT NULL'} ` +
    (defaultValue === null ? '' : `DEFAULT '${defaultValue.replace(/'/g, "''")}'`)
  );
}

module.exports.up = async ({ sequelize }) => {
  await addColumnIfMissing(sequelize, 'Payrolls', 'payrollPeriodId', 'INTEGER NULL AFTER `id`');
  await addColumnIfMissing(sequelize, 'Payrolls', 'bank_number', 'VARCHAR(100) NULL AFTER `email`');
  await addColumnIfMissing(sequelize, 'Payrolls', 'employee_name', 'VARCHAR(255) NULL');
  await addColumnIfMissing(sequelize, 'Payrolls', 'employee_email', 'VARCHAR(255) NULL');
  await addColumnIfMissing(sequelize, 'Payrolls', 'allowances', "JSON DEFAULT ('{}')");
  await addColumnIfMissing(sequelize, 'ReminderDeliveries', 'payrollPeriodId', 'INTEGER NULL AFTER `id`');
  await addColumnIfMissing(sequelize, 'PartnerCustomers', 'autoBillingEnabled', 'BOOLEAN NOT NULL DEFAULT TRUE');
  await addColumnIfMissing(sequelize, 'PartnerCustomers', 'nextBillingDate', 'DATE NULL');

  await ensureEnum(sequelize, 'Payments', 'method', ['Stripe', 'PayPal', 'NETS'], null, false);
  await ensureEnum(sequelize, 'Payments', 'status', ['Paid', 'Failed', 'Pending', 'Refunded'], 'Paid');
  await ensureEnum(sequelize, 'Payrolls', 'payment_status', ['Pending', 'Approved', 'Paid'], 'Pending');
  await removeDuplicateProviderReferenceIndexes(sequelize);
  await ensureIndex(sequelize, 'Payrolls', 'payrolls_payroll_period_id', ['payrollPeriodId']);
  await ensureIndex(
    sequelize,
    'ReminderDeliveries',
    'reminder_delivery_unique_recipient',
    ['payrollPeriodId', 'reminderKey', 'deadline', 'recipient'],
    true
  );
  await ensureIndex(
    sequelize,
    'PartnerCustomers',
    'idx_partner_customers_next_billing',
    ['autoBillingEnabled', 'nextBillingDate']
  );

  const relationships = [
    { name: 'fk_payment_invoice', table: 'Payments', column: 'invoiceId', parentTable: 'Invoices', onDelete: 'RESTRICT' },
    { name: 'fk_payment_recorded_by', table: 'Payments', column: 'recordedBy', parentTable: 'Users', onDelete: 'SET NULL' },
    { name: 'fk_password_reset_user', table: 'PasswordResetTokens', column: 'userId', parentTable: 'Users', onDelete: 'CASCADE' },
    { name: 'fk_request_sender', table: 'Requests', column: 'senderId', parentTable: 'Users', onDelete: 'RESTRICT' },
    { name: 'fk_payroll_period', table: 'Payrolls', column: 'payrollPeriodId', parentTable: 'PayrollPeriods', onDelete: 'SET NULL' },
    { name: 'fk_reminder_period', table: 'ReminderDeliveries', column: 'payrollPeriodId', parentTable: 'PayrollPeriods', onDelete: 'CASCADE' },
    { name: 'fk_partner_customer_plan', table: 'PartnerCustomers', column: 'subscriptionPlanId', parentTable: 'SubscriptionPlans', onDelete: 'RESTRICT' },
    { name: 'fk_demo_schedule_creator', table: 'SubscriptionDemoSchedules', column: 'createdBy', parentTable: 'Users', onDelete: 'RESTRICT' },
    { name: 'fk_demo_schedule_run', table: 'SubscriptionDemoSchedules', column: 'automationRunId', parentTable: 'SubscriptionAutomationRuns', onDelete: 'SET NULL' },
    { name: 'fk_test_bank_from_account', table: 'TestBankTransactions', column: 'fromAccountId', parentTable: 'TestBankAccounts', onDelete: 'SET NULL' },
    { name: 'fk_test_bank_to_account', table: 'TestBankTransactions', column: 'toAccountId', parentTable: 'TestBankAccounts', onDelete: 'RESTRICT' }
  ];

  const userAuditColumns = [
    ['SubscriptionInvoices', 'approvedBy', 'fk_subscription_invoice_approved_by'],
    ['SubscriptionInvoices', 'rejectedBy', 'fk_subscription_invoice_rejected_by'],
    ['SubscriptionAutomationRuns', 'triggeredBy', 'fk_subscription_run_triggered_by'],
    ['SubscriptionEmailDeliveries', 'triggeredBy', 'fk_subscription_email_triggered_by'],
    ['PayrollPeriods', 'uploadedBy', 'fk_payroll_period_uploaded_by'],
    ['PayrollPeriods', 'submittedBy', 'fk_payroll_period_submitted_by'],
    ['PayrollPeriods', 'approvedBy', 'fk_payroll_period_approved_by'],
    ['PayrollPeriods', 'rejectedBy', 'fk_payroll_period_rejected_by'],
    ['PayrollPeriods', 'closedBy', 'fk_payroll_period_closed_by']
  ];
  for (const [table, column, name] of userAuditColumns) {
    relationships.push({ name, table, column, parentTable: 'Users', onDelete: 'SET NULL' });
  }

  for (const relationship of relationships) {
    await addForeignKey(sequelize, relationship);
  }
};
