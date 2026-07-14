const { sequelize } = require('../config/db');

(async () => {
  await sequelize.query(
    "ALTER TABLE Payments MODIFY COLUMN status ENUM('Paid','Failed','Pending','Refunded') DEFAULT 'Paid'"
  );
  console.log('Payments.status enum now supports Refunded');
  await sequelize.close();
})().catch(async (err) => {
  console.error(err.message);
  try {
    await sequelize.close();
  } catch (_) {}
  process.exit(1);
});
