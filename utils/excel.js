const Excel = require('exceljs');
const fs = require('fs');

const normalizeHeader = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

async function parsePayrollExcel(filePath){
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const rows = [];
  const errors = [];
  const headerRow = ws.getRow(1);
  const headers = {};

  headerRow.eachCell((cell, colNumber) => {
    const normalized = normalizeHeader(cell.value && cell.value.text ? cell.value.text : cell.value);
    if (normalized) headers[normalized] = colNumber;
  });
  
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

    const getByHeader = (aliases, fallbackCellNum) => {
      const aliasList = Array.isArray(aliases) ? aliases : [aliases];
      for (const alias of aliasList) {
        const colNumber = headers[normalizeHeader(alias)];
        if (colNumber) return getCell(colNumber);
      }
      return getCell(fallbackCellNum);
    };
    
    const name = getByHeader(['name', 'employee_name'], 2);
    const email = getByHeader(['email', 'employee_email'], 3).toLowerCase();
    const bank_number = getByHeader(['bank_number', 'bank_no', 'bank_account', 'account_number', 'bank_account_number'], 4);
    const period = getByHeader(['period', 'pay_period', 'payroll_period'], 5);
    const grossRaw = getByHeader(['gross', 'gross_amount', 'gross_pay'], 6);
    const deductionsRaw = getByHeader(['deductions', 'deduction', 'deduction_amount'], 7);
    const netRaw = getByHeader(['net', 'net_amount', 'net_pay'], 8);
    const gross = parseFloat(grossRaw) || 0;
    const deductions = parseFloat(deductionsRaw) || 0;
    const net = parseFloat(netRaw) || 0;

    // Validate per row with better error messages
    const rowErrors = [];
    if (!name) {
      rowErrors.push(`Row ${rowNumber}: Missing name`);
    }
    if (!email) {
      rowErrors.push(`Row ${rowNumber}: Missing email`);
    } else {
      // More robust email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        rowErrors.push(`Row ${rowNumber}: Invalid email format (got: "${email}")`);
      }
    }
    if (!period) {
      rowErrors.push(`Row ${rowNumber}: Missing period`);
    }
    if (isNaN(gross) || gross < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid gross amount (got: ${grossRaw})`);
    }
    if (isNaN(deductions) || deductions < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid deductions amount (got: ${deductionsRaw})`);
    }
    if (isNaN(net) || net < 0) {
      rowErrors.push(`Row ${rowNumber}: Invalid net amount (got: ${netRaw})`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      rows.push({
        name,
        email,
        bank_number,
        period,
        gross,
        deductions,
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
