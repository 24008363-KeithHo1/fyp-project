const SUBSCRIPTION_INVOICE_STATUSES = Object.freeze([
  'Draft',
  'Approved',
  'Sent',
  'Viewed',
  'PendingPayment',
  'Paid',
  'PaymentFailed',
  'Overdue',
  'Rejected',
  'Refunded'
]);

// Every status change in the subscription billing module must follow this map.
// In particular, viewing a public invoice can only move Sent -> Viewed, so a
// customer opening an old link can never overwrite Paid or Overdue.
const ALLOWED_TRANSITIONS = Object.freeze({
  Draft: Object.freeze(['Approved', 'Rejected']),
  Approved: Object.freeze(['Sent']),
  Sent: Object.freeze(['Viewed', 'PendingPayment', 'Paid', 'Overdue']),
  Viewed: Object.freeze(['PendingPayment', 'Paid', 'Overdue']),
  PendingPayment: Object.freeze(['Paid', 'PaymentFailed', 'Overdue']),
  PaymentFailed: Object.freeze(['PendingPayment', 'Paid', 'Overdue']),
  Overdue: Object.freeze(['PendingPayment', 'Paid']),
  Rejected: Object.freeze(['Draft']),
  Paid: Object.freeze(['Refunded']),
  Refunded: Object.freeze([])
});

function canTransitionSubscriptionInvoice(fromStatus, toStatus) {
  if (!SUBSCRIPTION_INVOICE_STATUSES.includes(fromStatus)) return false;
  if (!SUBSCRIPTION_INVOICE_STATUSES.includes(toStatus)) return false;
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

function assertSubscriptionInvoiceTransition(fromStatus, toStatus) {
  if (!canTransitionSubscriptionInvoice(fromStatus, toStatus)) {
    const error = new Error(`Invalid subscription invoice transition: ${fromStatus} -> ${toStatus}`);
    error.code = 'INVALID_SUBSCRIPTION_INVOICE_TRANSITION';
    throw error;
  }
}

module.exports = {
  SUBSCRIPTION_INVOICE_STATUSES,
  ALLOWED_TRANSITIONS,
  canTransitionSubscriptionInvoice,
  assertSubscriptionInvoiceTransition
};
