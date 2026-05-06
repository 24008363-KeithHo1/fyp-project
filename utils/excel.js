const Excel = require('exceljs');
const fs = require('fs');

async function parsePayrollExcel(filePath){
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const gross = row.getCell(4).value || 0;
    const allowances = {
      housing: row.getCell(6).value || 0,
      transport: row.getCell(7).value || 0
    };
    const deductions = {
      tax: row.getCell(8).value || 0,
      cpf: row.getCell(9).value || 0
    };
    const totalAllowances = Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
    const net = parseFloat((gross + totalAllowances - totalDeductions).toFixed(2));
    rows.push({
      employee_name: row.getCell(1).value || '',
      employee_email: row.getCell(2).value || '',
      period: row.getCell(3).value || '',
      gross,
      allowances,
      deductions,
      net
    });
  });
  try { fs.unlinkSync(filePath); } catch(e){}
  return rows;
}

module.exports = { parsePayrollExcel };
