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
 * Bulk-upload format: one invoice per "block", matching the exact layout
 * of a single invoice's Excel export — so a real exported invoice can be
 * copied, edited, and reused directly as an import template. Layout,
 * repeated per invoice:
 *
 *   Number | Customer | Currency | Amount | Status | Due   <- invoice header (Number/Amount/Status are ignored on import — a fresh number is generated, amount is computed from line items, and new invoices always start as Draft)
 *   <actual values>                                         <- invoice data
 *   (optional blank row)
 *   Description | Qty | Unit Price | Discount % | Tax % | Line Total  <- items header (Line Total ignored — computed from the other columns)
 *   <line item row 1>
 *   <line item row 2>
 *   ...
 *   (a blank row, or the next invoice's "Number" header, ends the block)
 */
async function parseInvoiceExcelBlocks(filePath) {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  const invoices = [];
  const errors = [];

  const getCell = (row, cellNum) => {
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

  const isBlankRow = (row, cols) => cols.every((col) => !getCell(row, col));
  const normKey = (s) => String(s || '').trim().toLowerCase();

  // States:
  //   SEEK_HEADER      — waiting for a "Number" header row to start a new invoice block
  //   READ_INVOICE     — the current row is the actual invoice data (the row right after a header row)
  //   SEEK_ITEMS_HEADER— waiting for a "Description" header row (skipping optional blank rows first)
  //   READ_ITEMS       — reading line-item data rows, until a blank row or the next "Number" header
  //
  // Important: detecting colA === 'number' NEVER means "this row has the
  // data" — it always means "this row is a label row; the real data is on
  // the next row" — so it always transitions to READ_INVOICE and waits for
  // the following iteration, rather than reading data off the header row
  // itself.
  let mode = 'SEEK_HEADER';
  let current = null;

  function finalizeCurrent() {
    if (!current) return;
    const blockErrors = [];

    if (!current.customer_name) {
      blockErrors.push(`Row ${current.blockStartRow}: Missing Customer`);
    }
    let due_date = null;
    if (current.due_date_raw) {
      const parsed = new Date(current.due_date_raw);
      if (Number.isNaN(parsed.getTime())) {
        blockErrors.push(`Row ${current.blockStartRow}: Invalid Due date (got: "${current.due_date_raw}")`);
      } else {
        due_date = parsed;
      }
    }
    if (!current.items.length) {
      blockErrors.push(`Row ${current.blockStartRow}: Invoice for "${current.customer_name || '(unknown)'}" has no line items`);
    }

    if (blockErrors.length) {
      errors.push(...blockErrors);
    } else {
      invoices.push({
        customer_name: current.customer_name,
        email: null,
        currency: (current.currency || 'SGD').toUpperCase(),
        due_date,
        items: current.items
      });
    }
    current = null;
  }

  const totalRows = ws.rowCount || 0;
  for (let rowNumber = 1; rowNumber <= totalRows; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const colA = normKey(getCell(row, 1));

    if (mode === 'SEEK_HEADER') {
      if (colA === 'number') {
        mode = 'READ_INVOICE'; // next row holds the actual data
      }
      continue; // skip stray/blank rows between blocks
    }

    if (mode === 'READ_INVOICE') {
      // Column A (Number) and column D (Amount) and column E (Status) are
      // intentionally not read here — a fresh number is always generated,
      // the amount is always computed from the line items below, and a
      // newly-imported invoice always starts as Draft regardless of
      // whatever those columns say (e.g. if this row came from copying a
      // real exported invoice, which would show its old real values).
      current = {
        customer_name: getCell(row, 2),
        currency: getCell(row, 3),
        due_date_raw: getCell(row, 6),
        items: [],
        blockStartRow: rowNumber
      };
      mode = 'SEEK_ITEMS_HEADER';
      continue;
    }

    if (mode === 'SEEK_ITEMS_HEADER') {
      if (isBlankRow(row, [1, 2, 3, 4, 5, 6])) continue; // optional blank separator
      if (colA === 'description') {
        mode = 'READ_ITEMS';
        continue;
      }
      // Malformed: no items header where one was expected. Report and
      // abandon this invoice, then try to resync — if this row is itself
      // the next invoice's header label, wait for ITS data on the next row;
      // otherwise just keep seeking a header from here.
      errors.push(`Row ${rowNumber}: Expected a line-items header ("Description, Qty, Unit Price, Discount %, Tax %") after the invoice row for "${current.customer_name || '(unknown)'}", but found something else — this invoice was skipped.`);
      current = null;
      mode = (colA === 'number') ? 'READ_INVOICE' : 'SEEK_HEADER';
      continue;
    }

    if (mode === 'READ_ITEMS') {
      if (isBlankRow(row, [1, 2, 3, 4, 5, 6])) {
        finalizeCurrent();
        mode = 'SEEK_HEADER';
        continue;
      }
      if (colA === 'number') {
        // This row is a header label for the next invoice, not data yet —
        // finalize the one we were building, then wait for the data row.
        finalizeCurrent();
        mode = 'READ_INVOICE';
        continue;
      }
      // Column F (Line Total) is intentionally not read — it's always
      // recomputed from qty/unit_price/discount/tax, same as a manually
      // created invoice, rather than trusted from the file.
      current.items.push({
        description: getCell(row, 1),
        qty: getCell(row, 2),
        unit_price: getCell(row, 3),
        discount_rate: getCell(row, 4),
        tax_rate: getCell(row, 5)
      });
      continue;
    }
  }

  // End of file — finalize whatever invoice was still being accumulated
  // (covers a file with no trailing blank row after the last block).
  if (current) finalizeCurrent();

  try { fs.unlinkSync(filePath); } catch(e){}
  return { invoices, errors };
}

module.exports = { parsePayrollExcel, parseInvoiceExcelBlocks };