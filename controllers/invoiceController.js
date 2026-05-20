const Invoice = require('../models/Invoice');
const InvoiceItem = require('../models/InvoiceItem');
const { sequelize } = require('../config/db');
const { generateInvoicePDF } = require('../utils/pdf');
const { sendEmail } = require('../utils/email');
const crypto = require('crypto');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeLineItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { errors: [{ field: 'items', message: 'At least one line item is required.' }] };
  }

  const errors = [];
  const lineItems = rawItems.map((item, index) => {
    const description = (item && item.description ? String(item.description) : '').trim();
    const qty = Number(item && item.qty);
    const unitPrice = Number(item && item.unit_price);
    const taxRate = Number(item && item.tax_rate ? item.tax_rate : 0);
    const discountRate = Number(item && item.discount_rate ? item.discount_rate : 0);

    if (!description) {
      errors.push({ field: `items[${index}].description`, message: 'Description is required.' });
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ field: `items[${index}].qty`, message: 'Quantity must be greater than zero.' });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.push({ field: `items[${index}].unit_price`, message: 'Unit price must be zero or greater.' });
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      errors.push({ field: `items[${index}].tax_rate`, message: 'Tax rate must be between 0 and 100.' });
    }
    if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
      errors.push({ field: `items[${index}].discount_rate`, message: 'Discount rate must be between 0 and 100.' });
    }

    const lineSubtotal = round2(qty * unitPrice);
    const lineDiscount = round2(lineSubtotal * (discountRate / 100));
    const taxable = round2(lineSubtotal - lineDiscount);
    const lineTax = round2(taxable * (taxRate / 100));
    const lineTotal = round2(taxable + lineTax);

    return {
      description,
      qty: round2(qty),
      unit_price: round2(unitPrice),
      tax_rate: round2(taxRate),
      discount_rate: round2(discountRate),
      line_subtotal: lineSubtotal,
      line_discount: lineDiscount,
      line_tax: lineTax,
      line_total: lineTotal
    };
  });

  if (errors.length) {
    return { errors };
  }

  const subtotal = round2(lineItems.reduce((sum, item) => sum + item.line_subtotal, 0));
  const discountTotal = round2(lineItems.reduce((sum, item) => sum + item.line_discount, 0));
  const taxTotal = round2(lineItems.reduce((sum, item) => sum + item.line_tax, 0));
  const total = round2(subtotal - discountTotal + taxTotal);

  return {
    lineItems,
    summary: {
      subtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      total
    }
  };
}

exports.create = async (req, res) => {
  try {
    const { customer_name, amount, due_date, items } = req.body;
    const errors = [];
    let parsedAmount = Number(amount);
    let normalizedItems = null;
    let summary = null;

    if (!customer_name || !customer_name.trim()) {
      errors.push({ field: 'customer_name', message: 'Customer name is required.' });
    }
    if (due_date && Number.isNaN(new Date(due_date).getTime())) {
      errors.push({ field: 'due_date', message: 'Due date is invalid.' });
    }

    if (Array.isArray(items) && items.length) {
      const normalized = normalizeLineItems(items);
      if (normalized.errors) {
        errors.push(...normalized.errors);
      } else {
        normalizedItems = normalized.lineItems;
        summary = normalized.summary;
        parsedAmount = normalized.summary.total;
      }
    } else if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      errors.push({ field: 'amount', message: 'Amount must be greater than zero when no line items are provided.' });
    }

    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const count = await Invoice.count();
    const seq = count + 1;
    const now = new Date();
    const prefix = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
    const number = `INV-${prefix}-${String(seq).padStart(4,'0')}`;
    const currency = String((req.body && req.body.currency) || 'SGD').toUpperCase();
    const data = Object.assign({}, req.body && req.body.data ? req.body.data : {}, {
      line_items: normalizedItems || null,
      summary: summary || null,
      currency
    });

    const tx = await sequelize.transaction();
    let inv;
    try {
      inv = await Invoice.create({ number, customer_name: customer_name.trim(), amount: round2(parsedAmount), currency, due_date, data }, { transaction: tx });
      if (normalizedItems && normalizedItems.length) {
        await InvoiceItem.bulkCreate(
          normalizedItems.map((item, index) => ({
            invoiceId: inv.id,
            line_no: index + 1,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            discount_rate: item.discount_rate,
            tax_rate: item.tax_rate,
            line_subtotal: item.line_subtotal,
            line_discount: item.line_discount,
            line_tax: item.line_tax,
            line_total: item.line_total
          })),
          { transaction: tx }
        );
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.list = async (req, res) => {
  const invoices = await Invoice.findAll({ order: [['id','DESC']] });
  res.json(invoices);
};

exports.get = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
};

exports.exportPdf = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const pdfStream = await generateInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  pdfStream.pipe(res);
};

exports.exportExcel = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const rows = [];
  rows.push('Number,Customer,Currency,Amount,Status,Due');
  const dueStr = inv.due_date ? (inv.due_date instanceof Date ? inv.due_date.toISOString().split('T')[0] : new Date(inv.due_date).toISOString().split('T')[0]) : '';
  rows.push(`"${inv.number}","${inv.customer_name}","${inv.currency || 'SGD'}",${inv.amount},"${inv.status}","${dueStr}"`);

  let lineItems = inv.data && Array.isArray(inv.data.line_items) ? inv.data.line_items : [];
  if (!lineItems.length) {
    const dbItems = await InvoiceItem.findAll({ where: { invoiceId: inv.id }, order: [['line_no', 'ASC'], ['id', 'ASC']] });
    lineItems = dbItems.map((row) => row.toJSON());
  }
  if (lineItems.length) {
    rows.push('');
    rows.push('Description,Qty,Unit Price,Discount %,Tax %,Line Total');
    lineItems.forEach((item) => {
      rows.push(`"${item.description}",${item.qty},${item.unit_price},${item.discount_rate},${item.tax_rate},${item.line_total}`);
    });
  }

  const csv = `${rows.join('\n')}\n`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.csv"`);
  res.send(csv);
};

exports.send = async (req, res) => {
  try {
    const inv = await Invoice.findByPk(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const to = (req.body && req.body.email) || (inv.data && inv.data.email);
    if (!to) return res.status(400).json({ error: 'No recipient email provided' });
    let token = inv.data && inv.data.view_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      const data = Object.assign({}, inv.data || {}, { view_token: token });
      await inv.update({ data });
    }
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${appUrl}/invoices/${inv.id}/view?token=${token}`;
    const html = `<p>Invoice <strong>${inv.number}</strong> for ${inv.customer_name} — Amount: ${inv.currency || 'SGD'} ${inv.amount}</p><p>View online: <a href="${link}">${link}</a></p>`;
    await sendEmail(to, `Invoice ${inv.number}`, html);
    if (inv.status !== 'Sent') await inv.update({ status: 'Sent' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.viewPage = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).send('Invoice not found');
  const token = req.query.token;
  if (inv.data && inv.data.view_token && token && token === inv.data.view_token && inv.status !== 'Viewed') {
    try { await inv.update({ status: 'Viewed' }); } catch (e) { }
  }
  res.render('invoices/view', { invoice: inv });
};
