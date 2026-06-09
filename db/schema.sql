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
  employee_name VARCHAR(255) NOT NULL,
  employee_email VARCHAR(255) NOT NULL,
  period VARCHAR(100),
  gross DECIMAL(10,2),
  allowances JSON DEFAULT ('{}'),
  deductions JSON DEFAULT ('{}'),
  net DECIMAL(10,2),
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payment history for Stripe, PayPal, NETS and bank-transfer confirmations
CREATE TABLE IF NOT EXISTS Payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoiceId INT NOT NULL,
  invoiceNumber VARCHAR(100) NOT NULL,
  method ENUM('Stripe','PayPal','NETS','BankTransfer','Manual') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'SGD',
  status ENUM('Paid','Failed','Pending') DEFAULT 'Paid',
  providerReference VARCHAR(255) UNIQUE,
  paidAt DATETIME NOT NULL,
  recordedBy INT,
  data JSON,
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
-- Password reset tokens
CREATE TABLE IF NOT EXISTS PasswordResetTokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL UNIQUE,
  userId INT NOT NULL,
  expiresAt DATETIME,
  used BOOLEAN DEFAULT FALSE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
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
ALTER TABLE Payments
  MODIFY COLUMN method ENUM('Stripe','PayPal','NETS','BankTransfer','Manual') NOT NULL;

-- Roles are stored directly on Users.role. The old Roles table is no longer used.
DROP TABLE IF EXISTS Roles;

-- Seed admin user (email: paul@paul.com, password: 123456)
-- The password below is bcrypt('123456')
SET @admin_email  = 'paul@paul.com';
SET @admin_name   = 'Seed Admin';
SET @admin_pass   = '$2a$10$2XKQBAhc.iZv4BIHDuRqauaXN8Ir.fryZ9VnUOjOvwyDiZoC3I9AS';

INSERT INTO Users (name, email, password, role, isActive, isVerified, createdAt, updatedAt)
SELECT @admin_name, @admin_email, @admin_pass, 'Admin', 1, 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Users WHERE email = @admin_email);

-- If admin exists but is not verified / role not set / password plaintext, fix them:
UPDATE Users
SET
  password = @admin_pass,
  role = 'Admin',
  isVerified = 1,
  updatedAt = NOW()
WHERE email = @admin_email;

-- Final verification queries (run to inspect)
SELECT id, name, email, role, isActive, isVerified FROM Users WHERE email = 'paul@paul.com';
