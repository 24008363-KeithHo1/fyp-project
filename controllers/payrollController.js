const Payroll = require('../models/Payroll');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { parsePayrollExcel } = require('../utils/excel');
const { generatePayslipPDF } = require('../utils/pdf');

exports.uploadMiddleware = upload.single('file');

exports.upload = async (req, res) => {
  try {
    const rows = await parsePayrollExcel(req.file.path);
    const created = [];
    for (const r of rows) {
      const p = await Payroll.create({ employee_name: r.employee_name, employee_email: r.employee_email, period: r.period, gross: r.gross, net: r.net, data: r });
      created.push(p);
    }
    res.json({ imported: created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.list = async (req, res) => {
  const all = await Payroll.findAll({ order: [['id','DESC']] });
  res.json(all);
};

exports.get = async (req, res) => {
  const p = await Payroll.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
};

exports.payslip = async (req, res) => {
  const p = await Payroll.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const stream = await generatePayslipPDF(p);
  res.setHeader('Content-Type','application/pdf');
  stream.pipe(res);
};
