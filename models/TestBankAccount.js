const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const TestBankAccount = sequelize.define('TestBankAccount', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ownerType: { type: DataTypes.ENUM('Company', 'Employee', 'Customer', 'Supplier'), allowNull: false },
  ownerReference: { type: DataTypes.STRING, allowNull: false },
  accountName: { type: DataTypes.STRING, allowNull: false },
  bankName: { type: DataTypes.STRING, defaultValue: 'FYP Test Bank' },
  accountNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  balance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  currency: { type: DataTypes.STRING, defaultValue: 'SGD' },
  status: { type: DataTypes.ENUM('Active', 'Closed'), defaultValue: 'Active' },
  data: { type: DataTypes.JSON, defaultValue: {} }
});

module.exports = TestBankAccount;
