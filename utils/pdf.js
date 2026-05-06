const PDFDocument = require('pdfkit');

async function generateInvoicePDF(invoice){
  const doc = new PDFDocument();
  doc.fontSize(20).text('Invoice', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Number: ${invoice.number}`);
  doc.text(`Customer: ${invoice.customer_name}`);
  doc.text(`Amount: ${invoice.amount}`);
  doc.text(`Status: ${invoice.status}`);
  doc.end();
  return doc;
}

async function generatePayslipPDF(payroll){
  const doc = new PDFDocument();
  doc.fontSize(18).text('PAYSLIP', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12)
    .text(`Employee: ${payroll.employee_name}`)
    .text(`Email: ${payroll.employee_email}`)
    .text(`Period: ${payroll.period}`);
  
  doc.moveDown();
  doc.fontSize(11).text('EARNINGS:', { underline: true });
  doc.fontSize(10).text(`  Gross: $${payroll.gross}`);
  const allowances = payroll.allowances || {};
  Object.entries(allowances).forEach(([key, val]) => {
    doc.text(`  ${key}: $${val}`);
  });
  
  doc.moveDown();
  doc.fontSize(11).text('DEDUCTIONS:', { underline: true });
  const deductions = payroll.deductions || {};
  Object.entries(deductions).forEach(([key, val]) => {
    doc.text(`  ${key}: $${val}`);
  });
  
  doc.moveDown();
  doc.fontSize(12).text(`NET PAY: $${payroll.net}`, { bold: true });
  doc.end();
  return doc;
}

module.exports = { generateInvoicePDF, generatePayslipPDF };
