const TestBankAccount = require('../models/TestBankAccount');
const TestBankTransaction = require('../models/TestBankTransaction');
const crypto = require('crypto');

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeAccountNumber(prefix, seed) {
  const digest = crypto.createHash('sha1').update(String(seed || prefix)).digest('hex');
  const numeric = BigInt(`0x${digest.slice(0, 10)}`).toString().slice(0, 10).padStart(10, '0');
  return `${prefix}-${numeric}`;
}

async function findOrCreateTestAccount({ ownerType, ownerReference, accountName, openingBalance = 0 }) {
  const reference = String(ownerReference || '').trim() || ownerType;
  const [account] = await TestBankAccount.findOrCreate({
    where: { ownerType, ownerReference: reference },
    defaults: {
      accountName: accountName || reference,
      accountNumber: makeAccountNumber(ownerType.toUpperCase().slice(0, 3), reference),
      balance: openingBalance
    }
  });
  return account;
}

async function ensureCompanyAccount() {
  return findOrCreateTestAccount({
    ownerType: 'Company',
    ownerReference: 'company-payroll',
    accountName: 'Company Payroll Clearing Account',
    openingBalance: 1000000
  });
}

async function creditAccount(account, amount) {
  await account.update({ balance: money(account.balance) + money(amount) });
  return account;
}

async function debitAccount(account, amount) {
  await account.update({ balance: money(account.balance) - money(amount) });
  return account;
}

async function simulateSalaryRelease({ payroll, releasedBy }) {
  const amount = money(payroll.net);
  const employeeEmail = payroll.email || payroll.employee_email || `payroll-${payroll.id}`;
  const employeeName = payroll.name || payroll.employee_name || employeeEmail;
  const companyAccount = await ensureCompanyAccount();
  const employeeAccount = await findOrCreateTestAccount({
    ownerType: 'Employee',
    ownerReference: employeeEmail,
    accountName: employeeName,
    openingBalance: 0
  });
  const reference = `SALARY-${payroll.id}-${Date.now()}`;

  await debitAccount(companyAccount, amount);
  await creditAccount(employeeAccount, amount);
  const transaction = await TestBankTransaction.create({
    type: 'SalaryRelease',
    fromAccountId: companyAccount.id,
    toAccountId: employeeAccount.id,
    amount,
    currency: 'SGD',
    reference,
    description: `Salary release for payroll ${payroll.id}`,
    processedAt: new Date(),
    data: {
      payrollId: payroll.id,
      employeeEmail,
      releasedBy
    }
  });

  return { companyAccount, employeeAccount, transaction };
}

async function simulateRefundDestination({ payment, invoice, refundedBy }) {
  const amount = money(payment.amount);
  const supplierReference = invoice && invoice.data && invoice.data.email
    ? invoice.data.email
    : `invoice-${payment.invoiceId}`;
  const refundAccount = await findOrCreateTestAccount({
    ownerType: 'Supplier',
    ownerReference: supplierReference,
    accountName: invoice ? invoice.customer_name : payment.invoiceNumber,
    openingBalance: 0
  });
  const reference = `REFUND-${payment.id}-${Date.now()}`;

  await creditAccount(refundAccount, amount);
  const transaction = await TestBankTransaction.create({
    type: 'PaymentReversal',
    toAccountId: refundAccount.id,
    amount,
    currency: payment.currency || 'SGD',
    reference,
    description: `Payment reversal / supplier refund for ${payment.invoiceNumber}`,
    processedAt: new Date(),
    data: {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      refundedBy
    }
  });

  return { refundAccount, transaction };
}

module.exports = {
  findOrCreateTestAccount,
  ensureCompanyAccount,
  simulateSalaryRelease,
  simulateRefundDestination
};
