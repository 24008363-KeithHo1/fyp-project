# Partner Subscription Invoice System

## Purpose and scope

This module automates monthly partner subscription billing for demonstration
customers such as `Customer 1`, `Customer 2`, and so on. Business types and
billing scenarios may resemble beauty and wellness partners, but the records
must not contain real partner identities or private information.

The module is intentionally separate from the legacy Invoice and Payment
system. Its models, controllers, routes, services, PDFs, emails, and payment
ledger use `Subscription` names and dedicated database tables.

## Responsibility matrix

| Responsibility | Admin | Finance |
|---|---:|---:|
| Create and maintain partner customer records | Full | Billing view/edit only |
| Assign subscription plans and customer status | Full | View |
| Generate subscription invoice drafts | No | Full |
| Review, edit, reject, and approve drafts | No | Full |
| Send approved invoices | No | Full |
| Monitor payments and overdue invoices | No | Full |
| Record verified bank transfers | No | Full |
| Reconcile and refund Stripe test payments | No | Full |
| View subscription revenue and export CSV | No | Full |

Automated generation is performed by the system and monitored by Finance.

## Supported plans

| Plan | Monthly fee | Demonstration benefits |
|---|---:|---|
| Basic | SGD 49 | Business listing |
| Standard | SGD 99 | Listing and appointment management |
| Premium | SGD 199 | Listing, appointment management, marketing tools, and analytics |

## Required payment scope

The payment implementation follows the project requirements:

1. Credit-card payment through Stripe Checkout in test mode.
2. Bank-transfer instructions on the secure customer invoice page.
3. Webhook-based Stripe payment-status updates.

PayPal and NETS are not part of this module.

Bank transfers are not automatically confirmed. Finance verifies the bank
statement and records the transfer using the Finance payment form. The amount
must exactly match the invoice, the bank reference must be unique, and a
pending Stripe checkout must be reconciled before a bank transfer is recorded.

## Main workflow

```text
Admin customer master data
        |
        v
Monthly system generation -> Draft
        |
        v
Finance review -> Approve -> Send email and PDF
        |
        v
Secure customer invoice link
        |
        +---- Stripe Checkout ----> verified return/webhook ----> Paid
        |
        +---- Bank instructions --> Finance verification ------> Paid
        |
        v
Receipt, payment history, revenue report, overdue monitoring
```

The main invoice states are:

`Draft`, `Approved`, `Sent`, `Viewed`, `PendingPayment`, `Paid`,
`PaymentFailed`, `Overdue`, `Rejected`, and `Refunded`.

State transitions are controlled by
`services/subscriptionInvoiceLifecycle.js`. A public page view cannot overwrite
a final state such as `Paid` or `Refunded`.

## Isolation from the legacy system

Dedicated records include:

- `PartnerCustomers`
- `SubscriptionPlans`
- `SubscriptionInvoices`
- `SubscriptionInvoiceItems`
- `SubscriptionPayments`
- `SubscriptionEmailDeliveries`
- `SubscriptionAutomationRuns`
- `SubscriptionDemoSchedules`

The subscription payment provider field permits only `Stripe` and
`BankTransfer`. Finance routes require authentication and the `Finance` role.
Partner master-data mutation routes require the `Admin` role.

## Automation schedule

All billing automation uses the `Asia/Singapore` timezone.

| Automation | Default schedule |
|---|---|
| Monthly invoice generation | Midnight on days 28–31; executes only on the final calendar day |
| Overdue status check | Daily at 12:10 AM |
| Overdue reminders | Daily at 12:20 AM |
| Finance demo scheduler | Polls persistent one-time schedules |

Reminder milestones are 1, 7, and 14 days overdue. Duplicate run keys,
invoice-period constraints, payment keys, and reminder keys prevent repeated
processing.

## Environment configuration

Keep real values in `.env`; never commit them.

```dotenv
APP_URL=http://localhost:3000

# Stripe test mode
STRIPE_SECRET_KEY=sk_test_...
SUBSCRIPTION_STRIPE_WEBHOOK_SECRET=whsec_...

# Demonstration bank instructions
SUBSCRIPTION_BANK_NAME=Demo Bank Singapore
SUBSCRIPTION_BANK_ACCOUNT_NAME=Vaniday Singapore Demo
SUBSCRIPTION_BANK_ACCOUNT_NUMBER=DEMO-ACCOUNT-001

# Optional scheduler overrides
SUBSCRIPTION_INVOICE_TIMEZONE=Asia/Singapore
SUBSCRIPTION_INVOICE_CRON=0 0 28-31 * *
SUBSCRIPTION_INVOICE_AUTOMATION_ENABLED=true
SUBSCRIPTION_OVERDUE_CRON=10 0 * * *
SUBSCRIPTION_OVERDUE_AUTOMATION_ENABLED=true
SUBSCRIPTION_REMINDER_CRON=20 0 * * *
SUBSCRIPTION_REMINDER_AUTOMATION_ENABLED=true
SUBSCRIPTION_DEMO_SCHEDULER_ENABLED=true
```

The subscription webhook uses its own signing secret. Do not substitute the
legacy invoice webhook variable.

## Webhook configuration

For a public HTTPS deployment, create a Stripe event destination with:

```text
https://your-domain.example/subscription-payment/webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Copy that endpoint's `whsec_...` signing secret into
`SUBSCRIPTION_STRIPE_WEBHOOK_SECRET`, restart the application, and perform a
test-mode payment. Stripe requires the unmodified raw request body for
signature verification; `app.js` registers the subscription webhook before
the JSON body parser.

For local testing after installing and authenticating Stripe CLI:

```powershell
stripe listen `
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired `
  --forward-to localhost:3000/subscription-payment/webhook
```

Use the signing secret printed by `stripe listen` as
`SUBSCRIPTION_STRIPE_WEBHOOK_SECRET` for that local session.

Official references:

- [Receive Stripe webhook events](https://docs.stripe.com/webhooks)
- [Forward events with Stripe CLI](https://docs.stripe.com/stripe-cli/use-cli)
- [Stripe test cards](https://docs.stripe.com/testing)

## Finance pages and routes

| Purpose | Location |
|---|---|
| Customer records | `/partner-customers` |
| Finance invoice workspace | `/finance/subscription-invoices` |
| Secure customer invoice | `/subscription-invoices/view/:token` |
| Stripe checkout | `POST /subscription-payments/:token/stripe-checkout` |
| Subscription webhook | `POST /subscription-payment/webhook` |
| Customer receipt | `/subscription-payments/:token/receipt` |
| Finance payment history | `/api/subscription-invoices/payments` |
| Finance revenue CSV | `/api/subscription-invoices/revenue-export.csv` |

Public invoice, receipt, and checkout routes are rate limited. Finance mutation
routes are authenticated and role-restricted.

## Database and verification

Apply migrations before starting:

```powershell
npm run db:migrate
npm start
```

Run the automated regression suite:

```powershell
node --test tests\*.test.js
```

Do not use Sequelize `sync({ alter: true })` or manually alter production
tables.
