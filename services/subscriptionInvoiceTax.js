function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateTaxFromRate(subtotalValue, taxRateValue) {
  const subtotal = Number(subtotalValue);
  const taxRate = Number(taxRateValue);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new Error('Subtotal must be a valid non-negative amount.');
  }
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new Error('Tax rate must be between 0 and 100 percent.');
  }
  const normalizedSubtotal = roundMoney(subtotal);
  const normalizedRate = Math.round((taxRate + Number.EPSILON) * 10000) / 10000;
  const taxAmount = roundMoney(normalizedSubtotal * normalizedRate / 100);
  return {
    subtotal: normalizedSubtotal,
    taxRate: normalizedRate,
    taxAmount,
    totalAmount: roundMoney(normalizedSubtotal + taxAmount)
  };
}

function taxRateForInvoice(invoice) {
  const storedRate = invoice && invoice.data && Number(invoice.data.taxRate);
  if (Number.isFinite(storedRate)) return storedRate;
  const subtotal = Number(invoice && invoice.subtotal);
  const taxAmount = Number(invoice && invoice.taxAmount);
  return subtotal > 0 && Number.isFinite(taxAmount)
    ? Math.round(((taxAmount / subtotal) * 100 + Number.EPSILON) * 10000) / 10000
    : 0;
}

module.exports = { calculateTaxFromRate, taxRateForInvoice };
