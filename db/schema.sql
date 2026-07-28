-- Full updated schema for Automated Invoicing & Payroll System (fyp)
CREATE DATABASE IF NOT EXISTS `soi-2026-0036-zaynyi` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `soi-2026-0036-zaynyi`;

-- Ensure Users table (with auth, MFA, timestamps)
CREATE TABLE IF NOT EXISTS Users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('Admin','Finance','HR','Staff') DEFAULT 'Staff',
  isActive BOOLEAN DEFAULT TRUE,
  isVerified BOOLEAN DEFAULT FALSE,
  mfaEnabled BOOLEAN DEFAULT FALSE,
  mfaSecret VARCHAR(255),
  phone VARCHAR(255),
  title VARCHAR(255),
  department VARCHAR(255),
  address VARCHAR(255),
  bio TEXT,
  profileImage VARCHAR(255),
  employeeId VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS PasswordResetTokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL UNIQUE,
  userId INT NOT NULL,
  expiresAt DATETIME,
  used BOOLEAN DEFAULT FALSE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS Requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  senderId INT NOT NULL,
  senderName VARCHAR(255),
  recipient ENUM('HR','Finance','Admin') NOT NULL,
  status ENUM('Pending','Completed','Incomplete') DEFAULT 'Pending',
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_request_sender FOREIGN KEY (senderId) REFERENCES Users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS AutomationSettings (
  `key` VARCHAR(255) NOT NULL PRIMARY KEY,
  `value` TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Invoices
CREATE TABLE IF NOT EXISTS Invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(100) NOT NULL UNIQUE,
  customer_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  status ENUM('Draft','Sent','Viewed','Paid','Overdue') DEFAULT 'Draft',
  due_date DATE,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Invoice line items (normalized rows for reporting and auditing)
CREATE TABLE IF NOT EXISTS InvoiceItems (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoiceId INT NOT NULL,
  line_no INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_rate DECIMAL(5,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  line_subtotal DECIMAL(10,2) NOT NULL,
  line_discount DECIMAL(10,2) DEFAULT 0,
  line_tax DECIMAL(10,2) DEFAULT 0,
  line_total DECIMAL(10,2) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_item_invoice FOREIGN KEY (invoiceId) REFERENCES Invoices(id) ON DELETE CASCADE,
  INDEX idx_invoice_items_invoiceId (invoiceId),
  INDEX idx_invoice_items_line_no (line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Partner Subscription Billing module: independent plan catalogue.
CREATE TABLE IF NOT EXISTS SubscriptionPlans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code ENUM('BASIC','STANDARD','PREMIUM') NOT NULL UNIQUE,
  name ENUM('Basic','Standard','Premium') NOT NULL UNIQUE,
  monthlyFee DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  features JSON NOT NULL,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Partner Subscription Billing module: independent customer master data.
-- Do not link this table to the existing Invoices or Payments tables.
CREATE TABLE IF NOT EXISTS PartnerCustomers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customerCode VARCHAR(30) NOT NULL UNIQUE,
  businessName VARCHAR(255) NOT NULL,
  businessType VARCHAR(100) NOT NULL,
  contactPerson VARCHAR(255) NOT NULL,
  billingEmail VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  billingAddress VARCHAR(500),
  region VARCHAR(100),
  subscriptionPlanId INT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  billingCycle ENUM('Monthly') NOT NULL DEFAULT 'Monthly',
  paymentTermsDays INT UNSIGNED NOT NULL DEFAULT 14,
  subscriptionStartDate DATE NOT NULL,
  autoBillingEnabled BOOLEAN NOT NULL DEFAULT TRUE,
  nextBillingDate DATE,
  status ENUM('Active','Suspended','Inactive') NOT NULL DEFAULT 'Active',
  notes TEXT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_partner_customers_status (status),
  INDEX idx_partner_customers_business_type (businessType),
  INDEX idx_partner_customers_billing_email (billingEmail),
  INDEX idx_partner_customers_next_billing (autoBillingEnabled, nextBillingDate),
  INDEX partner_customers_subscription_plan_id (subscriptionPlanId),
  CONSTRAINT fk_partner_customer_subscription_plan FOREIGN KEY (subscriptionPlanId) REFERENCES SubscriptionPlans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Monthly subscription invoices. These tables are intentionally separate
-- from the legacy Invoices, InvoiceItems and Payments tables.
CREATE TABLE IF NOT EXISTS SubscriptionInvoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  partnerCustomerId INT NOT NULL,
  subscriptionPlanId INT NOT NULL,
  customerCodeSnapshot VARCHAR(30) NOT NULL,
  businessNameSnapshot VARCHAR(255) NOT NULL,
  billingEmailSnapshot VARCHAR(255) NOT NULL,
  planCodeSnapshot VARCHAR(30) NOT NULL,
  planNameSnapshot VARCHAR(100) NOT NULL,
  planFeaturesSnapshot JSON NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT 'Monthly Subscription Fee',
  subtotal DECIMAL(10,2) NOT NULL,
  taxAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalAmount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  billingPeriodStart DATE NOT NULL,
  billingPeriodEnd DATE NOT NULL,
  invoiceDate DATE NOT NULL,
  dueDate DATE NOT NULL,
  paymentTermsDaysSnapshot INT UNSIGNED NOT NULL,
  status ENUM(
    'Draft','Approved','Sent','Viewed','PendingPayment','Paid',
    'PaymentFailed','Overdue','Rejected','Refunded'
  ) NOT NULL DEFAULT 'Draft',
  publicToken VARCHAR(128) UNIQUE,
  approvedBy INT,
  approvedAt DATETIME,
  rejectedBy INT,
  rejectedAt DATETIME,
  rejectionReason TEXT,
  sentAt DATETIME,
  viewedAt DATETIME,
  paymentPendingAt DATETIME,
  paidAt DATETIME,
  paymentFailedAt DATETIME,
  overdueAt DATETIME,
  refundedAt DATETIME,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_subscription_invoice_customer FOREIGN KEY (partnerCustomerId) REFERENCES PartnerCustomers(id),
  CONSTRAINT fk_subscription_invoice_plan FOREIGN KEY (subscriptionPlanId) REFERENCES SubscriptionPlans(id),
  UNIQUE KEY subscription_invoice_customer_period_unique (partnerCustomerId, billingPeriodStart, billingPeriodEnd),
  INDEX idx_subscription_invoices_status (status),
  INDEX idx_subscription_invoices_due_date (dueDate),
  INDEX idx_subscription_invoices_customer (partnerCustomerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SubscriptionInvoiceItems (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscriptionInvoiceId INT NOT NULL,
  lineNumber INT UNSIGNED NOT NULL DEFAULT 1,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unitPrice DECIMAL(10,2) NOT NULL,
  lineAmount DECIMAL(10,2) NOT NULL,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_subscription_invoice_item_invoice FOREIGN KEY (subscriptionInvoiceId) REFERENCES SubscriptionInvoices(id) ON DELETE CASCADE,
  UNIQUE KEY subscription_invoice_item_line_unique (subscriptionInvoiceId, lineNumber)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SubscriptionAutomationRuns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  runKey VARCHAR(100) NOT NULL UNIQUE,
  type ENUM('MonthlyInvoiceGeneration') NOT NULL DEFAULT 'MonthlyInvoiceGeneration',
  billingPeriod VARCHAR(7) NOT NULL,
  triggerSource ENUM('Scheduler','FinanceRecovery') NOT NULL,
  triggeredBy INT,
  status ENUM('Running','Success','Partial','Failed') NOT NULL DEFAULT 'Running',
  scheduledFor DATETIME,
  startedAt DATETIME NOT NULL,
  completedAt DATETIME,
  eligibleCount INT UNSIGNED NOT NULL DEFAULT 0,
  generatedCount INT UNSIGNED NOT NULL DEFAULT 0,
  skippedCount INT UNSIGNED NOT NULL DEFAULT 0,
  failedCount INT UNSIGNED NOT NULL DEFAULT 0,
  totalAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  errorMessage TEXT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscription_runs_period (type, billingPeriod),
  INDEX idx_subscription_runs_status (status, startedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SubscriptionEmailDeliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscriptionInvoiceId INT NOT NULL,
  emailType ENUM('Invoice','Reminder') NOT NULL DEFAULT 'Invoice',
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('Pending','Sent','Delivered','Failed','Skipped') NOT NULL DEFAULT 'Pending',
  messageId VARCHAR(255),
  attemptedAt DATETIME NOT NULL,
  sentAt DATETIME,
  deliveredAt DATETIME,
  failedAt DATETIME,
  errorMessage TEXT,
  triggeredBy INT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_subscription_delivery_invoice FOREIGN KEY (subscriptionInvoiceId) REFERENCES SubscriptionInvoices(id) ON DELETE CASCADE,
  INDEX idx_subscription_delivery_invoice_type (subscriptionInvoiceId, emailType),
  INDEX idx_subscription_delivery_status (status, attemptedAt),
  INDEX idx_subscription_delivery_recipient (recipient)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SubscriptionDemoSchedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  billingPeriod VARCHAR(7) NOT NULL,
  scheduledFor DATETIME NOT NULL,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Singapore',
  status ENUM('Scheduled','Running','Completed','Failed','Cancelled') NOT NULL DEFAULT 'Scheduled',
  createdBy INT NOT NULL,
  automationRunId INT,
  startedAt DATETIME,
  completedAt DATETIME,
  errorMessage TEXT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscription_demo_due (status, scheduledFor),
  INDEX idx_subscription_demo_creator (createdBy, createdAt),
  CONSTRAINT fk_demo_schedule_creator FOREIGN KEY (createdBy) REFERENCES Users(id),
  CONSTRAINT fk_demo_schedule_run FOREIGN KEY (automationRunId) REFERENCES SubscriptionAutomationRuns(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS SubscriptionPayments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscriptionInvoiceId INT NOT NULL,
  provider ENUM('Stripe') NOT NULL DEFAULT 'Stripe',
  status ENUM('Pending','Paid','Failed','Refunded') NOT NULL DEFAULT 'Pending',
  expectedAmount DECIMAL(10,2) NOT NULL,
  receivedAmount DECIMAL(10,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  invoicePaymentKey VARCHAR(80) UNIQUE,
  checkoutSessionId VARCHAR(255) UNIQUE,
  providerReference VARCHAR(255) UNIQUE,
  attemptedAt DATETIME NOT NULL,
  paidAt DATETIME,
  failedAt DATETIME,
  failureReason TEXT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_subscription_payment_invoice FOREIGN KEY (subscriptionInvoiceId) REFERENCES SubscriptionInvoices(id) ON DELETE RESTRICT,
  INDEX idx_subscription_payment_invoice_status (subscriptionInvoiceId, status),
  INDEX idx_subscription_payment_provider_attempt (provider, attemptedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS PayrollPeriods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  periodStart DATE NOT NULL,
  periodEnd DATE NOT NULL,
  payrollUploadDeadline DATE NOT NULL,
  financeApprovalDeadline DATE NOT NULL,
  salaryReleaseDate DATE NOT NULL,
  status ENUM('Draft','PayrollUploaded','PendingApproval','Approved','Released','Closed') NOT NULL DEFAULT 'Draft',
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  uploadedBy INT,
  uploadedAt DATETIME,
  submittedBy INT,
  submittedAt DATETIME,
  submissionNotes TEXT,
  approvedBy INT,
  approvedAt DATETIME,
  rejectedBy INT,
  rejectedAt DATETIME,
  rejectionReason TEXT,
  releasedAt DATETIME,
  closedBy INT,
  closedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX payroll_periods_is_active (isActive),
  INDEX payroll_periods_period_start_period_end (periodStart, periodEnd),
  CONSTRAINT fk_payroll_period_uploaded_by FOREIGN KEY (uploadedBy) REFERENCES Users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payroll_period_submitted_by FOREIGN KEY (submittedBy) REFERENCES Users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payroll_period_approved_by FOREIGN KEY (approvedBy) REFERENCES Users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payroll_period_rejected_by FOREIGN KEY (rejectedBy) REFERENCES Users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payroll_period_closed_by FOREIGN KEY (closedBy) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payrolls
CREATE TABLE IF NOT EXISTS Payrolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payrollPeriodId INT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  bank_number VARCHAR(100),
  period VARCHAR(100),
  gross DECIMAL(10,2),
  deductions JSON DEFAULT ('{}'),
  allowances JSON DEFAULT ('{}'),
  net DECIMAL(10,2),
  payment_status ENUM('Pending','Approved','Paid') DEFAULT 'Pending',
  paid_at DATETIME,
  payment_method VARCHAR(100),
  employee_name VARCHAR(255),
  employee_email VARCHAR(255),
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX payrolls_payroll_period_id (payrollPeriodId),
  CONSTRAINT fk_payroll_period FOREIGN KEY (payrollPeriodId) REFERENCES PayrollPeriods(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ReminderDeliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payrollPeriodId INT,
  reminderKey VARCHAR(255) NOT NULL,
  deadline DATE NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  status ENUM('sent','failed','skipped') NOT NULL,
  source VARCHAR(255) NOT NULL DEFAULT 'scheduler',
  sentAt DATETIME,
  error TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY reminder_delivery_unique_recipient (payrollPeriodId, reminderKey, deadline, recipient),
  CONSTRAINT fk_reminder_period FOREIGN KEY (payrollPeriodId) REFERENCES PayrollPeriods(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payment history. BankTransfer is retained for historical records; new
-- payment flows use Stripe, PayPal, or NETS.
CREATE TABLE IF NOT EXISTS Payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoiceId INT NOT NULL,
  invoiceNumber VARCHAR(100) NOT NULL,
  method ENUM('Stripe','PayPal','NETS','BankTransfer') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'SGD',
  status ENUM('Paid','Failed','Pending','Refunded') DEFAULT 'Paid',
  providerReference VARCHAR(255) UNIQUE,
  paidAt DATETIME NOT NULL,
  recordedBy INT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoiceId) REFERENCES Invoices(id),
  CONSTRAINT fk_payment_recorded_by FOREIGN KEY (recordedBy) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS TestBankAccounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ownerType ENUM('Company','Employee','Customer') NOT NULL,
  ownerReference VARCHAR(255) NOT NULL,
  accountName VARCHAR(255) NOT NULL,
  bankName VARCHAR(255) DEFAULT 'FYP Test Bank',
  accountNumber VARCHAR(255) NOT NULL UNIQUE,
  balance DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'SGD',
  status ENUM('Active','Closed') DEFAULT 'Active',
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_test_bank_owner (ownerType, ownerReference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS TestBankTransactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('SalaryRelease','Refund','Adjustment') NOT NULL,
  fromAccountId INT,
  toAccountId INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'SGD',
  status ENUM('Completed','Failed') DEFAULT 'Completed',
  reference VARCHAR(255) NOT NULL UNIQUE,
  description VARCHAR(255),
  data JSON,
  processedAt DATETIME NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_test_bank_from_account FOREIGN KEY (fromAccountId) REFERENCES TestBankAccounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_test_bank_to_account FOREIGN KEY (toAccountId) REFERENCES TestBankAccounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit logs
CREATE TABLE IF NOT EXISTS AuditLogs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT,
  action VARCHAR(255),
  entity VARCHAR(255),
  entityId INT,
  meta JSON,
  ip VARCHAR(45),
  userAgent VARCHAR(512),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Idempotent ALTERs: add/drop columns if supported (MySQL 8+)
-- If your MySQL version doesn't support "IF NOT EXISTS" here, ignore these or run fallback ALTERs.
ALTER TABLE Users
  DROP COLUMN IF EXISTS RoleId,
  ADD COLUMN IF NOT EXISTS role ENUM('Admin','Finance','HR','Staff') DEFAULT 'Staff',
  ADD COLUMN IF NOT EXISTS isVerified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfaEnabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfaSecret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE Invoices
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'SGD';
ALTER TABLE Payrolls
  ADD COLUMN IF NOT EXISTS bank_number VARCHAR(100) AFTER email,
  ADD COLUMN IF NOT EXISTS data JSON,
  ADD COLUMN IF NOT EXISTS payment_status ENUM('Pending','Approved','Paid') DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS paid_at DATETIME,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100);
ALTER TABLE Payments
  MODIFY COLUMN method ENUM('Stripe','PayPal','NETS','BankTransfer') NOT NULL;
ALTER TABLE Payments
  MODIFY COLUMN status ENUM('Paid','Failed','Pending','Refunded') DEFAULT 'Paid';

-- Roles are stored directly on Users.role. The old Roles table is no longer used.
DROP TABLE IF EXISTS Roles;

-- Admin seeding is handled by scripts/seedAdmin.js, which reads
-- SEED_ADMIN_EMAIL and SEED_ADMIN_PASS from environment variables
-- (see .env.example) and hashes the password at runtime.
-- Do NOT hardcode admin credentials or password hashes in this file.
