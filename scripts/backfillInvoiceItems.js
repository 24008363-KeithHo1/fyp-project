const { sequelize } = require('../config/db');
const Invoice = require('../models/Invoice');
const InvoiceItem = require('../models/InvoiceItem');

async function backfill() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    const invoices = await Invoice.findAll();
    console.log(`Found ${invoices.length} invoices`);

    for (const inv of invoices) {
      const data = inv.data || {};
      const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
      if (!lineItems.length) continue;

      const existing = await InvoiceItem.count({ where: { invoiceId: inv.id } });
      if (existing) {
        console.log(`Invoice ${inv.id} (${inv.number}) already has ${existing} items — skipping`);
        continue;
      }

      const rows = lineItems.map((it, idx) => ({
        invoiceId: inv.id,
        line_no: idx + 1,
        description: it.description || '',
        qty: it.qty || 0,
        unit_price: it.unit_price || 0,
        discount_rate: it.discount_rate || 0,
        tax_rate: it.tax_rate || 0,
        line_subtotal: it.line_subtotal || ((it.qty || 0) * (it.unit_price || 0)),
        line_discount: it.line_discount || 0,
        line_tax: it.line_tax || 0,
        line_total: it.line_total || 0
      }));

      await InvoiceItem.bulkCreate(rows);
      console.log(`Inserted ${rows.length} items for invoice ${inv.id} (${inv.number})`);
    }

    console.log('Backfill complete');
    process.exit(0);
  } catch (err) {
    console.error('Backfill error', err);
    process.exit(1);
  }
}

backfill();
