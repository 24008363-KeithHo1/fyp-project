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
  doc.fontSize(18).text('Payslip', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Employee: ${payroll.employee_name}`);
  doc.text(`Period: ${payroll.period}`);
  doc.text(`Gross: ${payroll.gross}`);
  doc.text(`Net: ${payroll.net}`);
  doc.end();
  return doc;
}

module.exports = { generateInvoicePDF, generatePayslipPDF };
