const Invoice = require('../models/Invoice');
const Payroll = require('../models/Payroll');
const Payment = require('../models/Payment');

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthKey(date) {
  const d = date ? new Date(date) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addValidationIssue(issues, type, record, field, message) {
  issues.push({
    type,
    id: record.id,
    reference: record.number || record.employee_email || `#${record.id}`,
    field,
    message
  });
}

function getPayrollDueDate(payroll) {
  const data = payroll.data || {};
  const value = data.nextRunDate || data.dueDate || data.payrollDueDate;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

exports.summary = async (req, res) => {
  try {
    const [invoices, payrolls, payments] = await Promise.all([
      Invoice.findAll({ order: [['createdAt', 'ASC']] }),
      Payroll.findAll({ order: [['createdAt', 'ASC']] }),
      Payment.findAll({ order: [['paidAt', 'DESC'], ['id', 'DESC']] })
    ]);

    const invoiceStatus = {};
    const monthlyRevenue = {};
    const paymentMethodRevenue = { Stripe: 0, PayPal: 0, PayNow: 0 };
    const recentTransactions = payments.slice(0, 5).map((payment) => ({
      invoiceNumber: payment.invoiceNumber,
      method: payment.method,
      amount: money(payment.amount),
      currency: payment.currency || 'SGD',
      status: payment.status || 'Paid',
      paidAt: payment.paidAt
    }));
    let totalInvoiced = 0;
    let paidRevenue = 0;
    let outstandingRevenue = 0;
    let overdueRevenue = 0;
    let paidInvoiceCount = 0;
    let pendingPaymentCount = 0;
    let overdueInvoiceCount = 0;
    let failedPayPalCount = 0;

    invoices.forEach((invoice) => {
      const amount = money(invoice.amount);
      const status = invoice.status || 'Draft';
      invoiceStatus[status] = (invoiceStatus[status] || 0) + 1;
      totalInvoiced += amount;

      if (status === 'Paid') {
        paidInvoiceCount += 1;
        paidRevenue += amount;
        const key = monthKey(invoice.updatedAt || invoice.createdAt);
        monthlyRevenue[key] = (monthlyRevenue[key] || 0) + amount;
      } else {
        outstandingRevenue += amount;
        pendingPaymentCount += 1;
      }

      if (status === 'Overdue') {
        overdueRevenue += amount;
        overdueInvoiceCount += 1;
      }
    });

    payments.forEach((payment) => {
      const method = payment.method || 'Manual';
      const amount = money(payment.amount);
      if ((method === 'Stripe' || method === 'PayPal' || method === 'PayNow') && payment.status === 'Paid') {
        paymentMethodRevenue[method] = (paymentMethodRevenue[method] || 0) + amount;
      }
      if (method === 'PayPal' && payment.status === 'Failed') {
        failedPayPalCount += 1;
      }
    });

    let payrollGross = 0;
    let payrollNet = 0;
    const payrollByPeriod = {};
    const now = new Date();
    const twoDaysFromNow = new Date(now.getTime() + (2 * 24 * 60 * 60 * 1000));
    let payrollDueSoonCount = 0;

    payrolls.forEach((payroll) => {
      const gross = money(payroll.gross);
      const net = money(payroll.net);
      payrollGross += gross;
      payrollNet += net;
      const period = payroll.period || 'Unassigned';
      payrollByPeriod[period] = (payrollByPeriod[period] || 0) + net;
      const dueDate = getPayrollDueDate(payroll);
      if (dueDate && dueDate >= now && dueDate <= twoDaysFromNow) {
        payrollDueSoonCount += 1;
      }
    });

    res.json({
      totals: {
        invoiceCount: invoices.length,
        payrollCount: payrolls.length,
        totalInvoiced,
        paidRevenue,
        outstandingRevenue,
        overdueRevenue,
        paidInvoiceCount,
        pendingPaymentCount,
        overdueInvoiceCount,
        failedPayPalCount,
        payrollDueSoonCount,
        payrollGross,
        payrollNet
      },
      charts: {
        invoiceStatus,
        monthlyRevenue,
        payrollByPeriod,
        paymentMethodRevenue
      },
      recentTransactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.validation = async (req, res) => {
  try {
    const [invoices, payrolls] = await Promise.all([
      Invoice.findAll({ order: [['id', 'DESC']] }),
      Payroll.findAll({ order: [['id', 'DESC']] })
    ]);

    const issues = [];
    const now = new Date();

    invoices.forEach((invoice) => {
      const amount = money(invoice.amount);
      if (!invoice.customer_name || !invoice.customer_name.trim()) {
        addValidationIssue(issues, 'Invoice', invoice, 'customer_name', 'Customer name is required.');
      }
      if (!invoice.number || !invoice.number.trim()) {
        addValidationIssue(issues, 'Invoice', invoice, 'number', 'Invoice number is required.');
      }
      if (amount <= 0) {
        addValidationIssue(issues, 'Invoice', invoice, 'amount', 'Invoice amount must be greater than zero.');
      }
      if (!invoice.due_date) {
        addValidationIssue(issues, 'Invoice', invoice, 'due_date', 'Due date is missing.');
      }
      if (invoice.due_date && new Date(invoice.due_date) < now && invoice.status !== 'Paid' && invoice.status !== 'Overdue') {
        addValidationIssue(issues, 'Invoice', invoice, 'status', 'Invoice is past due but not marked Overdue.');
      }
    });

    payrolls.forEach((payroll) => {
      if (!payroll.employee_name || !payroll.employee_name.trim()) {
        addValidationIssue(issues, 'Payroll', payroll, 'employee_name', 'Employee name is required.');
      }
      if (!payroll.employee_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payroll.employee_email)) {
        addValidationIssue(issues, 'Payroll', payroll, 'employee_email', 'A valid employee email is required.');
      }
      if (!payroll.period || !payroll.period.trim()) {
        addValidationIssue(issues, 'Payroll', payroll, 'period', 'Payroll period is required.');
      }
      if (money(payroll.gross) <= 0) {
        addValidationIssue(issues, 'Payroll', payroll, 'gross', 'Gross pay must be greater than zero.');
      }
      if (money(payroll.net) < 0) {
        addValidationIssue(issues, 'Payroll', payroll, 'net', 'Net pay cannot be negative.');
      }
      if (money(payroll.net) > money(payroll.gross)) {
        addValidationIssue(issues, 'Payroll', payroll, 'net', 'Net pay should not exceed gross pay.');
      }
    });

    res.json({
      issueCount: issues.length,
      issues
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
