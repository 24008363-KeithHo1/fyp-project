const PDFDocument = require('pdfkit');

async function generateInvoicePDF(invoice){
  const doc = new PDFDocument();
  const data = invoice.data || {};
  const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
  const summary = data.summary || {};
  const currency = invoice.currency || data.currency || 'SGD';

  doc.fontSize(20).text('Invoice', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Number: ${invoice.number}`);
  doc.text(`Customer: ${invoice.customer_name}`);
  doc.text(`Amount: ${currency} ${Number(invoice.amount || 0).toFixed(2)}`);
  doc.text(`Status: ${invoice.status}`);

  if (lineItems.length) {
    doc.moveDown();
    doc.fontSize(12).text('Line Items', { underline: true });
    lineItems.forEach((item, index) => {
      doc.fontSize(10).text(
        `${index + 1}. ${item.description} | Qty: ${item.qty} | Unit: ${item.unit_price} | Disc: ${item.discount_rate}% | Tax: ${item.tax_rate}% | Total: ${item.line_total}`
      );
    });

    doc.moveDown();
    doc.fontSize(11)
      .text(`Subtotal: ${currency} ${Number(summary.subtotal || 0).toFixed(2)}`)
      .text(`Discount: ${currency} ${Number(summary.discount_total || 0).toFixed(2)}`)
      .text(`Tax: ${currency} ${Number(summary.tax_total || 0).toFixed(2)}`)
      .text(`Total: ${currency} ${Number(summary.total || invoice.amount || 0).toFixed(2)}`);
  }

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
