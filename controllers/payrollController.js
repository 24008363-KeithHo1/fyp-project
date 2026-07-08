const Payroll = require('../models/Payroll');
const multer = require('multer');
const path = require('path');
const { logAction } = require('../utils/audit');
const { ensureUploadDir } = require('../utils/upload');

// Configure multer for Excel uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls, .csv) are allowed'));
    }
  }
});

const { parsePayrollExcel } = require('../utils/excel');
const { generatePayslipPDF } = require('../utils/pdf');
const normalizeDeductions = (deductions) => {
  if (deductions == null) return {};
  if (typeof deductions === 'object') return deductions;
  const parsed = parseFloat(deductions);
  return Number.isFinite(parsed) ? { amount: parsed } : {};
};

const ensurePayrollFields = (payload) => ({
  ...payload,
  deductions: normalizeDeductions(payload.deductions),
   
});
exports.uploadMiddleware = upload.single('file');

exports.upload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { rows, errors } = await parsePayrollExcel(req.file.path);
    
    // If there are errors but no valid rows, reject the upload
    if (errors.length > 0 && rows.length === 0) {
      return res.status(400).json({ error: 'Validation errors - no valid rows to import', details: errors });
    }
    
    const created = [];
    const updated = [];
    
    for (const r of rows) {
      // Try to find existing record by employee_email and period
      const existing = await Payroll.findOne({
        where: { 
          email: r.email,
          period: r.period
        }
      });

      const payrollData = ensurePayrollFields({
        name: r.name,
        email: r.email,
        period: r.period,
        gross: r.gross,
        deductions: r.deductions,
        net: r.net
      });

      if (existing) {
        await existing.update({ 
          name: payrollData.name,
          email: payrollData.email,
          gross: payrollData.gross,
          deductions: payrollData.deductions,
          net: payrollData.net
        });
        updated.push(existing);
      } else {
        const p = await Payroll.create(payrollData);
        created.push(p);
      }
    }
    
    const response = { 
      imported: created.length, 
      updated: updated.length,
      total: created.length + updated.length
    };
    
    // Include validation errors in response if any
    if (errors.length > 0) {
      response.warnings = `${errors.length} rows had validation issues and were skipped`;
      response.errorDetails = errors;
    }
    
    await logAction(req, 'payroll_upload', 'Payroll', null, { imported: created.length, updated: updated.length, filename: req.file.originalname, errors: errors.length });
    
    res.json(response);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(400).json({ error: err.message, stack: err.stack });
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

exports.update = async (req, res) => {
  try {
    const p = await Payroll.findByPk(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    
    const { name, email, period, gross, deductions, net } = req.body;
    
    await p.update({
      ...(name && { name }),
      ...(email && { email }),
      ...(period && { period }),
      ...(gross !== undefined && { gross }),
      ...(deductions !== undefined && { deductions: normalizeDeductions(deductions) }),
      ...(net !== undefined && { net })
    });
    
    await logAction(req, 'payroll_update', 'Payroll', p.id, { email: p.email, period: p.period, gross: p.gross, net: p.net });
    
    res.json({ message: 'Updated successfully', payroll: p });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.myslips = async (req, res) => {
  const payrolls = await Payroll.findAll({
    where: { email: req.user.email },
    order: [['id', 'DESC']]
  });
  res.json(payrolls);
};

exports.mypayslipsView = async (req, res) => {
  const payrolls = await Payroll.findAll({
    where: { email: req.user.email },
    order: [['id', 'DESC']]
  });
  res.render('mypayslips', { payrolls });
};

exports.payslip = async (req, res) => {
  const p = await Payroll.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  await logAction(req, 'payslip_download', 'Payroll', p.id, { email: p.email, period: p.period });
  const stream = await generatePayslipPDF(p);
  res.setHeader('Content-Type','application/pdf');
  stream.pipe(res);
};

exports.mypayslipsView = async (req, res) => {
  const payrolls = await Payroll.findAll({
    where: { email: req.user.email },
    order: [['id', 'DESC']]
  });
  res.render('mypayslips', { payrolls });
};
