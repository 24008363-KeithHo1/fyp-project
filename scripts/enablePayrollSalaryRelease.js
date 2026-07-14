const { sequelize } = require('../config/db');

async function columnExists(columnName) {
  const columns = await sequelize.getQueryInterface().describeTable('Payrolls');
  return Boolean(columns[columnName]);
}

async function addColumnIfMissing(columnName, definition) {
  if (!(await columnExists(columnName))) {
    await sequelize.query(`ALTER TABLE Payrolls ADD COLUMN ${columnName} ${definition}`);
  }
}

(async () => {
  await addColumnIfMissing('employee_name', 'VARCHAR(255)');
  await addColumnIfMissing('employee_email', 'VARCHAR(255)');
  await addColumnIfMissing('allowances', "JSON DEFAULT ('{}')");
  await addColumnIfMissing('data', 'JSON');
  await addColumnIfMissing('payment_status', "ENUM('Pending','Approved','Paid') DEFAULT 'Pending'");
  await addColumnIfMissing('paid_at', 'DATETIME');
  await addColumnIfMissing('payment_method', 'VARCHAR(100)');

  if (await columnExists('name')) {
    await sequelize.query('UPDATE Payrolls SET employee_name = name WHERE employee_name IS NULL');
  }
  if (await columnExists('email')) {
    await sequelize.query('UPDATE Payrolls SET employee_email = email WHERE employee_email IS NULL');
  }
  await sequelize.query("UPDATE Payrolls SET payment_status = 'Pending' WHERE payment_status IS NULL");

  console.log('Payroll salary release fields are ready');
  await sequelize.close();
})().catch(async (err) => {
  console.error(err.message);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
