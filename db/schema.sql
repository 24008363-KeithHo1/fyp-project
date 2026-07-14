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
