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
  INDEX idx_subscription_demo_creator (createdBy, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payrolls
CREATE TABLE IF NOT EXISTS Payrolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  bank_number VARCHAR(100),
  period VARCHAR(100),
  gross DECIMAL(10,2),
  deductions JSON DEFAULT ('{}'),
  net DECIMAL(10,2),
  payment_status ENUM('Pending','Approved','Paid') DEFAULT 'Pending',
  paid_at DATETIME,
  payment_method VARCHAR(100),
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Added: Payment history table for Stripe, PayPal, NETS and bank-transfer confirmations
CREATE TABLE IF NOT EXISTS Payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoiceId INT NOT NULL,
  invoiceNumber VARCHAR(100) NOT NULL,
  method ENUM('Stripe','PayPal','NETS','BankTransfer','Manual') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'SGD',
  status ENUM('Paid','Failed','Pending','Refunded') DEFAULT 'Paid',
  providerReference VARCHAR(255) UNIQUE,
  paidAt DATETIME NOT NULL,
  recordedBy INT,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  MODIFY COLUMN method ENUM('Stripe','PayPal','NETS','BankTransfer','Manual') NOT NULL;
ALTER TABLE Payments
  MODIFY COLUMN status ENUM('Paid','Failed','Pending','Refunded') DEFAULT 'Paid';

-- Roles are stored directly on Users.role. The old Roles table is no longer used.
DROP TABLE IF EXISTS Roles;

-- Admin seeding is handled by scripts/seedAdmin.js, which reads
-- SEED_ADMIN_EMAIL and SEED_ADMIN_PASS from environment variables
-- (see .env.example) and hashes the password at runtime.
-- Do NOT hardcode admin credentials or password hashes in this file.
