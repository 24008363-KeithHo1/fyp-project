const Payroll = require('../models/Payroll');
const PayrollPeriod = require('../models/PayrollPeriod');
const { sequelize } = require('../config/db');
const {
  canImportPayroll,
  getActivePayrollPeriod,
  recordPayrollUpload,
  refreshPayrollPeriodReleaseStatus
} = require('../services/payrollPeriod');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
const { simulateSalaryRelease } = require('../utils/testBank');
const normalizeDeductions = (deductions) => {
  if (deductions == null) return {};
  if (typeof deductions === 'object') return deductions;
  const parsed = parseFloat(deductions);
  return Number.isFinite(parsed) ? { amount: parsed } : {};
};

const ensurePayrollFields = (payload) => ({
  ...payload,
  payment_status: payload.payment_status || 'Pending',
  deductions: normalizeDeductions(payload.deductions),
   
});
const wantsJson = (req) => req.xhr || (req.get('accept') || '').includes('application/json') || (req.get('content-type') || '').includes('application/json');

function sendPayrollResult(req, res, statusCode, payload, redirectFallback = '/payroll') {
  if (wantsJson(req)) return res.status(statusCode).json(payload);
  const params = new URLSearchParams({
    status: statusCode >= 400 ? 'error' : 'success',
    message: payload.error || payload.message || ''
  });
  return res.redirect(`${redirectFallback}?${params.toString()}`);
}

async function assertPayrollRecordEditable(payroll) {
  if (!payroll.payrollPeriodId) return;
  const period = await PayrollPeriod.findByPk(payroll.payrollPeriodId);
  if (period && !['Draft', 'PayrollUploaded'].includes(period.status)) {
    throw new Error(`Payroll records are locked while the period is ${period.status}`);
  }
}
exports.uploadMiddleware = upload.single('file');

exports.activePeriod = async (req, res) => {
  try {
    const period = await getActivePayrollPeriod();
    const roleCanImport = ['Admin', 'HR'].includes(req.user.role);
    const workflowCanImport = canImportPayroll(period);

    res.json({
      period,
      canImport: roleCanImport && workflowCanImport,
      roleCanImport,
      workflowCanImport
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.upload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const activePeriod = await getActivePayrollPeriod();
    if (!canImportPayroll(activePeriod)) {
      try { fs.unlinkSync(req.file.path); } catch (cleanupError) {}
      return res.status(400).json({
        error: activePeriod
          ? 'Payroll can only be imported while the active period is Draft or Payroll Uploaded'
          : 'Create an active payroll period before importing payroll data'
      });
    }
    
    const { rows, errors } = await parsePayrollExcel(req.file.path);
    
    // Never advance the payroll workflow for an empty or entirely invalid file.
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid payroll rows were found', details: errors });
    }
    
    const created = [];
    const updated = [];
    
    await sequelize.transaction(async (transaction) => {
      for (const r of rows) {
        // A payroll record belongs to the active period even when the
        // spreadsheet uses a slightly different human-readable period label.
        const existing = await Payroll.findOne({
          where: {
            email: r.email,
            payrollPeriodId: activePeriod.id
          },
          transaction
        });

        const payrollData = ensurePayrollFields({
          payrollPeriodId: activePeriod.id,
          name: r.name,
          email: r.email,
          bank_number: r.bank_number,
          period: r.period,
          gross: r.gross,
          deductions: r.deductions,
          net: r.net
        });

        if (existing) {
          await existing.update({
            name: payrollData.name,
            email: payrollData.email,
            bank_number: payrollData.bank_number,
            period: payrollData.period,
            gross: payrollData.gross,
            deductions: payrollData.deductions,
            net: payrollData.net,
            payment_status: existing.payment_status || 'Pending'
          }, { transaction });
          updated.push(existing);
        } else {
          const p = await Payroll.create(payrollData, { transaction });
          created.push(p);
        }
      }

      await recordPayrollUpload(activePeriod, req.user && req.user.id, transaction);
    });
    
    const response = { 
      imported: created.length, 
      updated: updated.length,
      total: created.length + updated.length,
      payrollPeriod: { id: activePeriod.id, name: activePeriod.name, status: activePeriod.status }
    };
    
    // Include validation errors in response if any
    if (errors.length > 0) {
      response.warnings = `${errors.length} rows had validation issues and were skipped`;
      response.errorDetails = errors;
    }
    
    await logAction(req, 'payroll_upload', 'PayrollPeriod', activePeriod.id, {
      imported: created.length,
      updated: updated.length,
      filename: req.file.originalname,
      errors: errors.length,
      status: activePeriod.status
    });
    
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
    await assertPayrollRecordEditable(p);
    
    const { name, email, bank_number, period, gross, deductions, net } = req.body;
    
    await p.update({
      ...(name && { name }),
      ...(email && { email }),
      ...(bank_number !== undefined && { bank_number }),
      ...(period && { period }),
      ...(gross !== undefined && { gross }),
      ...(deductions !== undefined && { deductions: normalizeDeductions(deductions) }),
      ...(net !== undefined && { net })
    });
    
    await logAction(req, 'payroll_update', 'Payroll', p.id, { email: p.email, bank_number: p.bank_number, period: p.period, gross: p.gross, net: p.net });
    
    res.json({ message: 'Updated successfully', payroll: p });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const p = await Payroll.findByPk(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    await assertPayrollRecordEditable(p);

    const auditMeta = {
      email: p.email,
      bank_number: p.bank_number,
      period: p.period,
      gross: p.gross,
      net: p.net
    };

    await p.destroy();
    await logAction(req, 'payroll_delete', 'Payroll', Number(req.params.id), auditMeta);

    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.approvePayroll = async (req, res) => {
  try {
    const p = await Payroll.findByPk(req.params.id);
    if (!p) return sendPayrollResult(req, res, 404, { error: 'Payroll not found' });
    if (p.payrollPeriodId) {
      return sendPayrollResult(req, res, 400, { error: 'Approve linked payroll records from the Finance Payroll Approvals page' });
    }
    if (p.payment_status === 'Paid') {
      return sendPayrollResult(req, res, 400, { error: 'Paid payroll cannot be approved again' });
    }
    if (p.payment_status === 'Approved') {
      return sendPayrollResult(req, res, 400, { error: 'Payroll is already approved' });
    }

    await p.update({ payment_status: 'Approved' });
    await logAction(req, 'payroll_approved', 'Payroll', p.id, {
      payrollId: p.id,
      employeeEmail: p.email,
      approvedBy: req.user ? req.user.id : null
    });

    return sendPayrollResult(req, res, 200, { message: 'Payroll approved successfully.', payroll: p });
  } catch (err) {
    return sendPayrollResult(req, res, 400, { error: err.message });
  }
};

exports.releaseSalary = async (req, res) => {
  try {
    const p = await Payroll.findByPk(req.params.id);
    if (!p) return sendPayrollResult(req, res, 404, { error: 'Payroll not found' });
    if (p.payment_status === 'Paid') {
      return sendPayrollResult(req, res, 400, { error: 'Salary has already been released for this payroll' });
    }
    if (p.payment_status !== 'Approved') {
      return sendPayrollResult(req, res, 400, { error: 'Payroll must be approved before salary release' });
    }
    if (p.payrollPeriodId) {
      const period = await PayrollPeriod.findByPk(p.payrollPeriodId);
      if (!period || period.status !== 'Approved') {
        return sendPayrollResult(req, res, 400, { error: 'The linked payroll period must be approved before salary release' });
      }
    }

    const releasedAt = new Date();
    const paymentMethod = 'Simulated Bank Transfer';
    const bankResult = await simulateSalaryRelease({
      payroll: p,
      releasedBy: req.user ? req.user.id : null
    });
    await p.update({
      payment_status: 'Paid',
      paid_at: releasedAt,
      payment_method: paymentMethod,
      data: Object.assign({}, p.data || {}, {
        salaryRelease: {
          testBankAccountId: bankResult.employeeAccount.id,
          testBankAccountNumber: bankResult.employeeAccount.accountNumber,
          testBankTransactionId: bankResult.transaction.id,
          testBankReference: bankResult.transaction.reference
        }
      })
    });

    await logAction(req, 'salary_released', 'Payroll', p.id, {
      payrollId: p.id,
      employeeId: p.email,
      employeeEmail: p.email,
      releasedBy: req.user ? req.user.id : null,
      releasedAt: releasedAt.toISOString(),
      paymentMethod,
      testBankAccountId: bankResult.employeeAccount.id,
      testBankAccountNumber: bankResult.employeeAccount.accountNumber,
      testBankTransactionId: bankResult.transaction.id,
      testBankReference: bankResult.transaction.reference
    });

    let periodProgress = null;
    if (p.payrollPeriodId) {
      periodProgress = await refreshPayrollPeriodReleaseStatus(p.payrollPeriodId);
      if (periodProgress.transitioned) {
        await logAction(req, 'payroll_period_released', 'PayrollPeriod', p.payrollPeriodId, {
          paid: periodProgress.paid,
          total: periodProgress.total
        });
      }
    }

    const periodMessage = periodProgress
      ? (periodProgress.released
        ? ' All salaries are paid and the payroll period is now Released.'
        : ` ${periodProgress.paid} of ${periodProgress.total} salaries have been released.`)
      : '';
    return sendPayrollResult(req, res, 200, {
      message: `Salary released using simulated bank transfer.${periodMessage}`,
      payroll: p,
      periodProgress: periodProgress ? {
        released: periodProgress.released,
        paid: periodProgress.paid,
        total: periodProgress.total
      } : null
    });
  } catch (err) {
    return sendPayrollResult(req, res, 400, { error: err.message });
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
