function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function parseReportDates(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const isCalendarDate = value => {
    if (!pattern.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  };
  if (from && !isCalendarDate(from)) throw new Error('Report start date must use a valid YYYY-MM-DD date.');
  if (to && !isCalendarDate(to)) throw new Error('Report end date must use a valid YYYY-MM-DD date.');
  if (from && to && from > to) throw new Error('Report start date cannot be after end date.');
  return {
    from: from || null,
    to: to || null
  };
}

function summarizeSubscriptionRevenue(payments = []) {
  const grossReceived = payments.reduce(
    (sum, payment) => sum + Number(payment.receivedAmount || 0),
    0
  );
  const refunded = payments.reduce(
    (sum, payment) => sum + Number(payment.refundAmount || 0),
    0
  );
  return {
    transactions: payments.length,
    paidTransactions: payments.filter(payment => payment.status === 'Paid').length,
    refundedTransactions: payments.filter(payment => payment.status === 'Refunded').length,
    grossReceived: roundMoney(grossReceived),
    refunded: roundMoney(refunded),
    netRevenue: roundMoney(grossReceived - refunded),
    currency: payments[0] ? payments[0].currency : 'SGD'
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildSubscriptionRevenueCsv(payments = []) {
  const headers = [
    'Paid At', 'Invoice Number', 'Customer', 'Provider', 'Status',
    'Received Amount', 'Refund Amount', 'Net Amount', 'Currency',
    'Payment Reference', 'Refund Reference', 'Refund Reason'
  ];
  const rows = payments.map(payment => {
    const invoice = payment.subscriptionInvoice || {};
    const received = Number(payment.receivedAmount || 0);
    const refund = Number(payment.refundAmount || 0);
    return [
      payment.paidAt ? new Date(payment.paidAt).toISOString() : '',
      invoice.number,
      invoice.businessNameSnapshot,
      payment.provider,
      payment.status,
      received.toFixed(2),
      refund.toFixed(2),
      (received - refund).toFixed(2),
      payment.currency,
      payment.providerReference,
      payment.refundReference,
      payment.refundReason
    ].map(csvCell).join(',');
  });
  return [headers.map(csvCell).join(','), ...rows].join('\r\n');
}

module.exports = {
  roundMoney,
  parseReportDates,
  summarizeSubscriptionRevenue,
  csvCell,
  buildSubscriptionRevenueCsv
};
