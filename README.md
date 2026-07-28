# Automated Invoicing & Payroll

## Partner Subscription Invoice system

The Partner Subscription Invoice system is a separate billing module for
business customers. It does not reuse or modify the project's legacy supplier
invoice and payment records.

- [Architecture, responsibilities, setup, and operations](docs/SUBSCRIPTION_INVOICE_SYSTEM.md)
- [Demonstration procedure and UAT evidence](docs/SUBSCRIPTION_INVOICE_UAT.md)

## Database setup

The database schema is versioned. Do not use Sequelize `sync({ alter: true })`
or manually change production tables.

For a new database:

1. Import `db/schema.sql`.
2. Run `npm run db:migrate`.
3. Optionally run `npm run seed` and `npm run seed:partners`.

For an existing database:

1. Create a database backup.
2. Run `npm run db:migrate`.
3. Start the application with `npm start`.

Applied migrations are recorded in the `SchemaMigrations` table. A migration
stops without deleting data if a new foreign key would conflict with orphaned
rows. Correct the reported records and run the migration again.
