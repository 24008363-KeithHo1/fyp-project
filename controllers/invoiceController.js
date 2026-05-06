const Invoice = require('../models/Invoice');
const { generateInvoicePDF } = require('../utils/pdf');

exports.create = async (req, res) => {
  try {
    const { customer_name, amount, due_date } = req.body;
    const number = `INV-${Date.now()}`;
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
