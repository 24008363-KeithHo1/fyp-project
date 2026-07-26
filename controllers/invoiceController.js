const Invoice = require('../models/Invoice');
const InvoiceItem = require('../models/InvoiceItem');
const Payment = require('../models/Payment');
const { sequelize } = require('../config/db');
const { generateInvoicePDF } = require('../utils/pdf');
const { sendEmail } = require('../utils/email');
const { logAction } = require('../utils/audit');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const { parseInvoiceExcel } = require('../utils/excel');

// Reuses the same uploads/ folder as payroll bulk upload for consistency.
const bulkUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});

const bulkUpload = multer({
  storage: bulkUploadStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls, .csv) are allowed'));
    }
  }
});

exports.bulkUploadMiddleware = bulkUpload.single('file');

/**
 * Constant-time string comparison to avoid leaking timing information
 * about how many leading characters of a secret token match. Falls back
 * to false on any length mismatch (timingSafeEqual throws if buffer
 * lengths differ, so we check that first rather than letting it throw).
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}


function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Escapes HTML special characters before interpolating user-supplied text
 * (e.g. customer_name, which can originate from bulk upload) into an
 * outgoing HTML email body, preventing stored HTML/script injection into
 * whatever client renders the email.
 */
function escapeHtmlForEmail(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/**
 * If an invoice is past its due date and not yet Paid, flip its status to
 * Overdue. Returns the (possibly updated) invoice. Safe to call on every
 * read — it's a no-op unless the invoice actually needs updating.
 */
async function applyOverdueStatus(invoice) {
  if (!invoice || !invoice.due_date) return invoice;
  const isPastDue = new Date(invoice.due_date) < new Date();
  const isEligible = invoice.status !== 'Paid' && invoice.status !== 'Overdue';
  if (isPastDue && isEligible) {
    await invoice.update({ status: 'Overdue' });
  }
  return invoice;
}

/**
 * Creates one invoice, retrying on invoice-number collisions. Shared by
 * both the single-invoice create() endpoint and bulkUpload(), so the
 * numbering/race-safety logic only lives in one place.
 *
 * Uses MAX(id), not COUNT(*) — see the matching comment in create() for
 * why: count() breaks permanently as soon as any invoice is ever deleted.
 */
async function createInvoiceWithRetry({ customer_name, amount, currency, due_date, data }) {
  const now = new Date();
  const prefix = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const MAX_ATTEMPTS = 3;
  let inv;
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const maxId = await Invoice.max('id');
    const seq = (maxId || 0) + 1 + attempt;
    const number = `INV-${prefix}-${String(seq).padStart(4,'0')}`;

    try {
      inv = await Invoice.create({ number, customer_name, amount: round2(amount), currency, due_date, data });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      const isUniqueViolation = e.name === 'SequelizeUniqueConstraintError';
      if (!isUniqueViolation) throw e;
      // otherwise loop and try again with a fresh number
    }
  }

  if (lastError) {
    const err = new Error('Could not generate a unique invoice number, please try again.');
    err.code = 'INVOICE_NUMBER_EXHAUSTED';
    throw err;
  }
  return inv;
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

    const currency = String((req.body && req.body.currency) || 'SGD').toUpperCase();
    const data = Object.assign({}, req.body && req.body.data ? req.body.data : {}, {
      line_items: normalizedItems || null,
      summary: summary || null,
      currency
    });

    const now = new Date();
    const prefix = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;

    // Retry loop: guards against a race where two concurrent requests both
    // read the same starting number and try to create the same invoice
    // number. The DB's unique constraint on `number` is the actual source
    // of truth; this is only ever used as a starting guess.
    //
    // Uses MAX(id) rather than COUNT(*): count() breaks permanently once
    // any invoice is ever deleted, since the row count drops but every
    // previously-used number stays taken — every subsequent invoice would
    // then keep colliding with an existing number, exhausting all retry
    // attempts. id is an InnoDB AUTO_INCREMENT column, which never reuses
    // a value even after a row is deleted, so basing the sequence on the
    // highest id ever issued stays collision-safe regardless of deletions.
    const MAX_ATTEMPTS = 3;
    let inv;
    let lastError;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const maxId = await Invoice.max('id');
      const seq = (maxId || 0) + 1 + attempt; // nudge forward on each retry
      const number = `INV-${prefix}-${String(seq).padStart(4,'0')}`;

      const tx = await sequelize.transaction();
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
        await logAction(req, 'create', 'Invoice', inv.id, { number: inv.number, customer_name, amount: round2(parsedAmount), currency, itemCount: normalizedItems ? normalizedItems.length : 0 });
        break; // success
      } catch (e) {
        await tx.rollback();
        lastError = e;
        const isUniqueViolation = e.name === 'SequelizeUniqueConstraintError';
        if (!isUniqueViolation) throw e; // any other error: fail immediately
        // otherwise loop and try again with a fresh number
      }
    }

    if (lastError) {
      // Exhausted retries — surface a clear error rather than a raw DB exception
      return res.status(409).json({ error: 'Could not generate a unique invoice number, please try again.' });
    }

    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.bulkUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { rows, errors } = await parseInvoiceExcel(req.file.path);

    if (errors.length > 0 && rows.length === 0) {
      return res.status(400).json({ error: 'Validation errors - no valid rows to import', details: errors });
    }

    const created = [];
    const failed = [];

    // Sequential, not Promise.all: each row calls createInvoiceWithRetry,
    // which reads Invoice.count() to pick the next invoice number. Running
    // these concurrently would let two rows read the same count and race
    // for the same number far more often than the retry logic is built to
    // absorb, so we trade some speed for correctness here.
    for (const r of rows) {
      try {
        const inv = await createInvoiceWithRetry({
          customer_name: r.customer_name,
          amount: r.amount,
          currency: r.currency,
          due_date: r.due_date,
          data: { line_items: null, summary: null, currency: r.currency, email: r.email || undefined }
        });
        created.push(inv);
      } catch (e) {
        failed.push({ customer_name: r.customer_name, error: e.message });
      }
    }

    const response = {
      imported: created.length,
      failed: failed.length,
      total: rows.length
    };
    if (errors.length > 0) {
      response.warnings = `${errors.length} rows had validation issues and were skipped`;
      response.errorDetails = errors;
    }
    if (failed.length > 0) {
      response.failedDetails = failed;
    }

    await logAction(req, 'bulk_upload', 'Invoice', null, { imported: created.length, failed: failed.length, filename: req.file.originalname, errors: errors.length });

    res.json(response);
  } catch (err) {
    console.error('Invoice bulk upload error:', err);
    res.status(400).json({ error: err.message });
  }
};

exports.list = async (req, res) => {
  const invoices = await Invoice.findAll({ order: [['id','DESC']] });
  await Promise.all(invoices.map(applyOverdueStatus));
  res.json(invoices);
};

exports.get = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  await applyOverdueStatus(inv);
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
  try {
    const inv = await Invoice.findByPk(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });

    const dueStr = inv.due_date
      ? (inv.due_date instanceof Date ? inv.due_date.toISOString().split('T')[0] : new Date(inv.due_date).toISOString().split('T')[0])
      : '';

    let lineItems = inv.data && Array.isArray(inv.data.line_items) ? inv.data.line_items : [];
    if (!lineItems.length) {
      const dbItems = await InvoiceItem.findAll({ where: { invoiceId: inv.id }, order: [['line_no', 'ASC'], ['id', 'ASC']] });
      lineItems = dbItems.map((row) => row.toJSON());
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Automated Invoicing & Payroll System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Invoice');

    // --- Invoice summary block ---
    sheet.columns = [
      { width: 28 }, { width: 22 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 }
    ];

    const headerRow = sheet.addRow(['Number', 'Customer', 'Currency', 'Amount', 'Status', 'Due']);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    });

    sheet.addRow([
      inv.number,
      inv.customer_name,
      inv.currency || 'SGD',
      Number(inv.amount),
      inv.status,
      dueStr
    ]);

    // --- Line items block (if any) ---
    if (lineItems.length) {
      sheet.addRow([]); // blank spacer row

      const itemHeaderRow = sheet.addRow(['Description', 'Qty', 'Unit Price', 'Discount %', 'Tax %', 'Line Total']);
      itemHeaderRow.font = { bold: true };
      itemHeaderRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
      });

      lineItems.forEach((item) => {
        sheet.addRow([
          item.description,
          Number(item.qty),
          Number(item.unit_price),
          Number(item.discount_rate),
          Number(item.tax_rate),
          Number(item.line_total)
        ]);
      });
    }

    // Format numeric columns (Amount, and the line-item numeric columns) as 2dp
    sheet.getColumn(4).numFmt = '0.00';
    sheet.getColumn(6).numFmt = '0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.send = async (req, res) => {
  try {
    const inv = await Invoice.findByPk(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const to = (req.body && req.body.email) || (inv.data && inv.data.email);
    if (!to) return res.status(400).json({ error: 'No recipient email provided' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(to).trim())) {
      return res.status(400).json({ error: 'Recipient email address is invalid.' });
    }
    let token = inv.data && inv.data.view_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      const data = Object.assign({}, inv.data || {}, { view_token: token });
      await inv.update({ data });
    }
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${appUrl}/invoices/${inv.id}/view?token=${token}`;
    // customer_name is escaped before going into this HTML email body since
    // it can originate from user-supplied input (e.g. bulk upload), and an
    // unescaped value here would let stored HTML/script run in whatever
    // mail client renders it.
    const safeCustomerName = escapeHtmlForEmail(inv.customer_name || '');
    const html = `<p>Invoice <strong>${inv.number}</strong> for ${safeCustomerName} — Amount: ${inv.currency || 'SGD'} ${inv.amount}</p><p>View online: <a href="${link}">${link}</a></p>`;
    await sendEmail(to, `Invoice ${inv.number}`, html);
    if (inv.status !== 'Sent') await inv.update({ status: 'Sent' });
    await logAction(req, 'send', 'Invoice', inv.id, { number: inv.number, recipient: to, amount: inv.amount });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const inv = await Invoice.findByPk(req.params.id, { transaction: tx });
    if (!inv) {
      await tx.rollback();
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const paidPayment = await Payment.findOne({ where: { invoiceId: inv.id, status: 'Paid' }, transaction: tx });
    if (inv.status === 'Paid' || paidPayment) {
      await tx.rollback();
      return res.status(400).json({ error: 'Paid invoices cannot be deleted. Refund or void the payment first.' });
    }

    await InvoiceItem.destroy({ where: { invoiceId: inv.id }, transaction: tx });
    await inv.destroy({ transaction: tx });
    await tx.commit();
    await logAction(req, 'delete', 'Invoice', inv.id, {
      number: inv.number,
      customer_name: inv.customer_name,
      amount: inv.amount
    });
    res.json({ ok: true, message: 'Invoice deleted successfully' });
  } catch (err) {
    await tx.rollback();
    res.status(500).json({ error: err.message });
  }
};

exports.viewPage = async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  if (!inv) return res.status(404).send('Invoice not found');
  const token = req.query.token;
  const expectedToken = inv.data && inv.data.view_token;
  if (!expectedToken || !token || !safeEqual(token, expectedToken)) {
    return res.status(403).send('Invalid or missing view token');
  }
  await applyOverdueStatus(inv);
  if (inv.status !== 'Viewed') {
    try { 
      await inv.update({ status: 'Viewed' });
      await logAction(req, 'view', 'Invoice', inv.id, { number: inv.number, viewedAt: new Date() });
    } catch (e) { }
  }
  res.render('invoices/view', { invoice: inv });
};
