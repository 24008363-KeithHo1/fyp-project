const Excel = require('exceljs');
const fs = require('fs');

async function parsePayrollExcel(filePath){
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const rows = [];
  const errors = [];
  
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    
    // Safely extract cell values
    const getCell = (cellNum) => {
      const cell = row.getCell(cellNum);
      if (!cell || cell.value === null || cell.value === undefined) return '';
      
      // Handle different value types
      let value = cell.value;
      
      // If it's an object with a richText property (Excel formatted text)
      if (typeof value === 'object' && value.richText) {
        return value.richText.map(rt => rt.text || rt).join('').trim();
      }
      
      // If it's an object with a text property
      if (typeof value === 'object' && value.text) {
        return value.text.trim();
      }
      
      // If it has a toString method, use it
      if (typeof value === 'object' && value.toString) {
        return value.toString().trim();
      }
      
      // Otherwise just stringify it
      return String(value).trim();
    };
    
    const employee_name = getCell(2);
    const employee_email = getCell(3).toLowerCase();
    const period = getCell(4);
    const gross = parseFloat(getCell(5)) || 0;
    const net = parseFloat(getCell(6)) || 0;
    const deductions = parseFloat(getCell(7)) || 0;

    // Validate per row with better error messages
    const rowErrors = [];
    if (!employee_name) {
      rowErrors.push(`Row ${rowNumber}: Missing employee_name`);
    }
    if (!employee_email) {
      rowErrors.push(`Row ${rowNumber}: Missing employee_email`);
    } else {
      // More robust email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(employee_email)) {
        rowErrors.push(`Row ${rowNumber}: Invalid email format (got: "${employee_email}")`);
      }
    }
    if (!period) {
      rowErrors.push(`Row ${rowNumber}: Missing period`);
    }
    if (isNaN(gross) || gross < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid gross amount (got: ${getCell(5)})`);
    }
    if (isNaN(net) || net < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid net amount (got: ${getCell(6)})`);
    }
    if (isNaN(deductions) || deductions < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid deductions amount (got: ${getCell(7)})`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      rows.push({
        employee_name,
        employee_email,
        period,
        gross,
        deductions: { amount: deductions },
        net
      });
    }
  });
  
  try { fs.unlinkSync(filePath); } catch(e){}
  return { rows, errors };
}

/**
 * Expected columns (1-indexed, column A is left blank/unused to mirror
 * the payroll sheet layout so both templates look consistent):
 *   B: customer_name    C: email (optional, used for "send" later)
 *   D: amount           E: currency (optional, defaults SGD)
 *   F: due_date (optional, YYYY-MM-DD or Excel date)
 */
async function parseInvoiceExcel(filePath){
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const rows = [];
  const errors = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const getCell = (cellNum) => {
      const cell = row.getCell(cellNum);
      if (!cell || cell.value === null || cell.value === undefined) return '';

      let value = cell.value;

      if (typeof value === 'object' && value.richText) {
        return value.richText.map(rt => rt.text || rt).join('').trim();
      }
      if (typeof value === 'object' && value.text) {
        return value.text.trim();
      }
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      if (typeof value === 'object' && value.toString) {
        return value.toString().trim();
      }
      return String(value).trim();
    };

    // Skip fully blank rows rather than reporting them as errors —
    // trailing empty rows are common in exported/edited spreadsheets.
    const isBlankRow = [2, 3, 4, 5, 6].every((col) => !getCell(col));
    if (isBlankRow) return;

    const customer_name = getCell(2);
    const email = getCell(3).toLowerCase();
    const amount = parseFloat(getCell(4));
    const currency = (getCell(5) || 'SGD').toUpperCase();
    const dueDateRaw = getCell(6);

    const rowErrors = [];
    if (!customer_name) {
      rowErrors.push(`Row ${rowNumber}: Missing customer_name`);
    }
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        rowErrors.push(`Row ${rowNumber}: Invalid email format (got: "${email}")`);
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid amount (got: "${getCell(4)}")`);
    }
    let due_date = null;
    if (dueDateRaw) {
      const parsed = new Date(dueDateRaw);
      if (Number.isNaN(parsed.getTime())) {
        rowErrors.push(`Row ${rowNumber}: Invalid due_date (got: "${dueDateRaw}")`);
      } else {
        due_date = parsed;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      rows.push({ customer_name, email: email || null, amount, currency, due_date });
    }
  });

  try { fs.unlinkSync(filePath); } catch(e){}
  return { rows, errors };
}

module.exports = { parsePayrollExcel, parseInvoiceExcel };