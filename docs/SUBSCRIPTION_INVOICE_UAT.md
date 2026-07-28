# Subscription Invoice Demonstration and UAT

## Presentation summary

The demonstration shows an isolated partner-subscription billing workflow:

1. Admin maintains synthetic partner customers and assigns Basic, Standard, or
   Premium subscriptions.
2. The system generates monthly draft invoices.
3. Finance reviews, edits, rejects, approves, and sends invoices.
4. The customer opens a secure link and pays by Stripe test card or follows
   demonstration bank-transfer instructions.
5. Stripe return/webhook validation or Finance bank verification marks the
   invoice paid.
6. The system generates a receipt, sends payment confirmation, records audit
   history, and updates the subscription revenue report.

The legacy Invoice and Payment system is not used by this workflow.

## Five-minute demonstration

### 1. Customer master data

- Sign in as Admin.
- Open `/partner-customers`.
- Show a synthetic customer, subscription plan, Net 14 terms, billing email,
  and active status.
- Explain that Admin owns master data while Finance has billing-only access.

### 2. Automatic invoice generation

- Sign in as Finance.
- Open `/finance/subscription-invoices`.
- Select a billing month.
- Use **Preview** to show eligible customers and duplicate prevention.
- Use **Generate now**, or choose an SGT time and demonstrate the scheduler.

### 3. Finance approval

- Open a Draft invoice.
- Show its immutable customer/plan snapshot and line item.
- Approve it and send it.
- Explain that the email contains a standalone PDF and a secure token link.

### 4. Customer payment

- Open the secure invoice link.
- Show Stripe as the only online credit-card option.
- Show the alternative bank-transfer instructions.
- In Stripe Checkout, use test card `4242 4242 4242 4242`, any future expiry,
  and any three-digit CVC. Never enter a real card.

### 5. Settlement evidence

- Return to the secure invoice and show `Paid`.
- Download the receipt PDF.
- In Finance, show the paid payment record, PaymentIntent reference, receipt,
  and revenue report.
- Export the subscription-only CSV and explain that refunds are subtracted
  from gross receipts to calculate net revenue.

## Verified UAT results — 29 July 2026

| Check | Result |
|---|---|
| Stripe API connected with a test key | Pass |
| Browser redirected to Stripe Checkout | Pass |
| Stripe session completed and reported paid | Pass |
| Test mode confirmed (`livemode=false`) | Pass |
| Local Subscription Payment marked Paid | Pass |
| Local Subscription Invoice marked Paid | Pass |
| Amount matched invoice total (SGD 49.00) | Pass |
| Currency matched (SGD) | Pass |
| PaymentIntent reference stored | Pass |
| Customer receipt PDF generated | Pass |
| Receipt email recorded as Sent | Pass |
| Signed local webhook replay accepted with HTTP 200 | Pass |
| Webhook replay left the payment Paid without duplication | Pass |
| Forged webhook signature rejected with HTTP 400 | Pass |
| Public invoice/receipt/checkout rate limiting | Pass |
| Finance mutation route authorization | Pass |
| Unsupported payment providers absent | Pass |
| Full automated regression suite | Pass — 100 tests |

Database consistency checks found:

- 10 subscription invoices at the time of testing.
- 1 publicly sent/paid test invoice with a strong 64-character token.
- No weak tokens on publicly accessible invoices.
- No orphan payments.
- No duplicate completed payments.
- No completed amount or currency mismatches.
- No unsupported subscription payment providers.

## Deployment-pending check

Real remote webhook delivery is not yet testable because the application URL
is `localhost:3000` and Stripe CLI is not installed. The signed handler and
idempotent replay have been verified locally.

After deployment:

1. Register the public HTTPS subscription webhook URL in Stripe Workbench.
2. Configure `SUBSCRIPTION_STRIPE_WEBHOOK_SECRET`.
3. Restart the application.
4. Perform a Stripe test payment.
5. Confirm a successful delivery in Stripe Workbench.
6. Confirm one Paid subscription payment, one Paid invoice, and one receipt
   delivery locally.

## Bank-transfer UAT checklist

- [ ] Customer can see demo bank name, account name, and account number.
- [ ] Customer is instructed to use the invoice number as the reference.
- [ ] Finance can select only an unpaid delivered subscription invoice.
- [ ] A mismatched amount is rejected.
- [ ] A duplicate bank reference is rejected.
- [ ] A future payment timestamp is rejected.
- [ ] A pending Stripe checkout blocks manual bank settlement.
- [ ] A valid transfer marks both payment and invoice Paid.
- [ ] Receipt PDF and confirmation email are produced.
- [ ] Bank transfer appears in the subscription revenue report.

Automated validation already covers the rejection and isolation rules. The
unchecked items should be demonstrated with a disposable invoice because a
successful bank-transfer test intentionally changes that invoice to Paid.

## Presentation talking points

- “The system generates drafts; Finance retains approval control.”
- “Customer and plan details are snapshotted so later master-data changes do
  not rewrite historical invoices.”
- “Stripe updates are verified by amount, currency, metadata, and webhook
  signature.”
- “Bank transfers remain manual because Finance must confirm the bank
  statement.”
- “Unique keys and transaction locks prevent duplicate invoices, payments,
  reminders, and webhook settlement.”
- “This module is technically and operationally separate from the teammate's
  legacy Invoice system.”
