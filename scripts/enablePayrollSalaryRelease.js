const { sequelize } = require('../config/db');

async function columnExists(columnName) {
  const columns = await sequelize.getQueryInterface().describeTable('Payrolls');
  return Boolean(columns[columnName]);
}

(async () => {
  if (await columnExists('name')) {
    await sequelize.query('UPDATE Payrolls SET employee_name = name WHERE employee_name IS NULL');
  }
  if (await columnExists('email')) {
    await sequelize.query('UPDATE Payrolls SET employee_email = email WHERE employee_email IS NULL');
  }
  await sequelize.query("UPDATE Payrolls SET payment_status = 'Pending' WHERE payment_status IS NULL");

  console.log('Payroll salary release data is backfilled; schema changes are handled by npm run db:migrate');
  await sequelize.close();
})().catch(async (err) => {
  console.error(err.message);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
