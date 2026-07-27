require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/db');

const migrationsDirectory = path.join(__dirname, '..', 'migrations');

async function ensureMigrationTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SchemaMigrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function run() {
  await sequelize.authenticate();
  await ensureMigrationTable();

  const [appliedRows] = await sequelize.query('SELECT name FROM SchemaMigrations');
  const applied = new Set(appliedRows.map((row) => row.name));
  const files = fs.readdirSync(migrationsDirectory)
    .filter((file) => /^\d+.*\.js$/.test(file))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Already applied: ${file}`);
      continue;
    }

    const migration = require(path.join(migrationsDirectory, file));
    if (!migration || typeof migration.up !== 'function') {
      throw new Error(`Migration ${file} must export an up() function.`);
    }

    console.log(`Applying: ${file}`);
    await migration.up({ sequelize, queryInterface: sequelize.getQueryInterface() });
    await sequelize.query(
      'INSERT INTO SchemaMigrations (name, appliedAt) VALUES (?, CURRENT_TIMESTAMP)',
      { replacements: [file] }
    );
    console.log(`Applied: ${file}`);
  }
}

run()
  .catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
