-- Full updated schema for Automated Invoicing & Payroll System (fyp)
CREATE DATABASE IF NOT EXISTS fyp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fyp;

-- Ensure Roles table (Sequelize timestamps included)
CREATE TABLE IF NOT EXISTS Roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ensure Users table (with auth, MFA, timestamps)
CREATE TABLE IF NOT EXISTS Users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  RoleId INT,
  isActive BOOLEAN DEFAULT TRUE,
  isVerified BOOLEAN DEFAULT FALSE,
  mfaEnabled BOOLEAN DEFAULT FALSE,
  mfaSecret VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (RoleId) REFERENCES Roles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Invoices
CREATE TABLE IF NOT EXISTS Invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(100) NOT NULL UNIQUE,
  customer_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('Draft','Sent','Viewed','Paid','Overdue') DEFAULT 'Draft',
  due_date DATE,
  data JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payrolls
CREATE TABLE IF NOT EXISTS Payrolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_name VARCHAR(255) NOT NULL,
  employee_email VARCHAR(255) NOT NULL,
  period VARCHAR(100),
  gross DECIMAL(10,2),
  net DECIMAL(10,2),
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

-- Invite tokens for onboarding
CREATE TABLE IF NOT EXISTS InviteTokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  expiresAt DATETIME,
  used BOOLEAN DEFAULT FALSE,
  inviterId INT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inviter_user FOREIGN KEY (inviterId) REFERENCES Users(id) ON DELETE SET NULL
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

-- Idempotent ALTERs: add missing columns if supported (MySQL 8+)
-- If your MySQL version doesn't support "IF NOT EXISTS" here, ignore these or run fallback ALTERs.
ALTER TABLE Roles
  ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE Users
  ADD COLUMN IF NOT EXISTS isVerified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfaEnabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfaSecret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Ensure roles exist (idempotent)
INSERT INTO Roles (name, createdAt, updatedAt)
VALUES
  ('Admin', NOW(), NOW()),
  ('Finance', NOW(), NOW()),
  ('HR', NOW(), NOW()),
  ('Staff', NOW(), NOW())
ON DUPLICATE KEY UPDATE updatedAt = NOW();

-- Seed admin user (email: paul@paul.com, password: 123456)
-- The password below is bcrypt('123456')
SET @admin_email  = 'paul@paul.com';
SET @admin_name   = 'Seed Admin';
SET @admin_pass   = '$2a$10$2XKQBAhc.iZv4BIHDuRqauaXN8Ir.fryZ9VnUOjOvwyDiZoC3I9AS';
SET @admin_roleid = (SELECT id FROM Roles WHERE name = 'Admin' LIMIT 1);

INSERT INTO Users (name, email, password, RoleId, isActive, isVerified, createdAt, updatedAt)
SELECT @admin_name, @admin_email, @admin_pass, @admin_roleid, 1, 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Users WHERE email = @admin_email);

-- If admin exists but is not verified / role not set / password plaintext, fix them:
UPDATE Users
SET
  password = @admin_pass,
  RoleId = COALESCE(RoleId, @admin_roleid),
  isVerified = 1,
  updatedAt = NOW()
WHERE email = @admin_email;

-- Final verification queries (run to inspect)
SELECT id, name, email, RoleId, isActive, isVerified FROM Users WHERE email = 'paul@paul.com';
SELECT id, name, createdAt, updatedAt FROM Roles;