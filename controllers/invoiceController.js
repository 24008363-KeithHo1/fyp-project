const Invoice = require('../models/Invoice');
const { generateInvoicePDF } = require('../utils/pdf');
const { sendEmail } = require('../utils/email');
const crypto = require('crypto');

exports.create = async (req, res) => {
  try {
    const { customer_name, amount, due_date } = req.body;
    const count = await Invoice.count();
    const seq = count + 1;
    const now = new Date();
    const prefix = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
    const number = `INV-${prefix}-${String(seq).padStart(4,'0')}`;
    const inv = await Invoice.create({ number, customer_name, amount, due_date });
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
  const csv = `Number,Customer,Amount,Status,Due\n"${inv.number}","${inv.customer_name}",${inv.amount},"${inv.status}","${inv.due_date?inv.due_date.toISOString().split('T')[0]:''}"\n`;
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
    const html = `<p>Invoice <strong>${inv.number}</strong> for ${inv.customer_name} — Amount: ${inv.amount}</p><p>View online: <a href="${link}">${link}</a></p>`;
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
