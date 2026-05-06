const Excel = require('exceljs');
const fs = require('fs');

async function parsePayrollExcel(filePath){
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    rows.push({
      employee_name: row.getCell(1).value || '',
      employee_email: row.getCell(2).value || '',
      period: row.getCell(3).value || '',
      gross: row.getCell(4).value || 0,
      net: row.getCell(5).value || 0,
    });
  });
  try { fs.unlinkSync(filePath); } catch(e){}
  return rows;
}

module.exports = { parsePayrollExcel };
