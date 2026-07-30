# Supplier PayPal Payouts Notes

This feature is for outgoing supplier/vendor payments. Some legacy invoice fields still say `customer`, but in this workflow that record represents the supplier.

## Main Flow

1. Finance/Admin creates or approves a supplier invoice.
2. The invoice must have `paypalEmail`, which should be the supplier Personal sandbox PayPal email.
3. Finance/Admin clicks `Pay Supplier` or uses the PayPal tab in `/finance/payments`.
4. The server calls PayPal Payouts:
   `POST /v1/payments/payouts`
5. The app stores the payout batch/item references and keeps the invoice unpaid while PayPal is pending.
6. Finance/Admin clicks `Check PayPal Status`.
7. Only when PayPal confirms `SUCCESS`, the app marks the invoice paid and moves money in Test Bank.

## Why There Is No PayPal Login Popup

PayPal Checkout uses `POST /v2/checkout/orders` and opens a buyer login/checkout popup. That is not correct for supplier payouts.

Supplier payouts are server-to-server. The Business sandbox account sends money directly to the supplier Personal sandbox email using PayPal credentials stored only in `.env`.

## Important Files

- `services/paypalService.js`: gets PayPal OAuth tokens and sends PayPal API requests.
- `services/supplierPayout.js`: validates invoices, submits payouts, checks payout status, and settles successful payouts locally.
- `controllers/paymentController.js`: exposes payout endpoints to the app UI.
- `routes/payment.js`: protects payout routes with Finance/Admin authorization.
- `models/Invoice.js`: stores supplier `paypalEmail` and supports `Approved` status.
- `models/Payment.js`: stores payout payment history and PayPal provider references.
- `models/TestBankAccount.js`: supports `Supplier` test bank accounts.
- `models/TestBankTransaction.js`: supports `SupplierPayment` transactions.
- `views/invoice.ejs`: invoice register buttons for approval, PayPal email, payout, and status check.
- `views/finance/payments.ejs`: PayPal supplier payout workspace and confirmation modal.
- `views/invoices/view.ejs`: invoice detail payout references and status actions.
- `migrations/009_add_supplier_paypal_payouts.js`: database schema updates for this feature.

## Safety Rules

- Do not store supplier PayPal passwords.
- Do not expose `PAYPAL_CLIENT_SECRET` to frontend JavaScript.
- Do not mark invoices paid when a payout batch is merely accepted.
- Do not debit/credit Test Bank until PayPal confirms payout item `SUCCESS`.
- Repeated status checks must not move money more than once.

## Manual Examiner Check

After PayPal confirms `SUCCESS`, log into the supplier Personal sandbox account in PayPal Developer Dashboard and check Activity for the incoming sandbox payout.
