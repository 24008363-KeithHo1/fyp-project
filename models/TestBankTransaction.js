const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const TestBankTransaction = sequelize.define('TestBankTransaction', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  type: { type: DataTypes.ENUM('SalaryRelease', 'Refund', 'Adjustment'), allowNull: false },
  fromAccountId: { type: DataTypes.INTEGER },
  toAccountId: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  currency: { type: DataTypes.STRING, defaultValue: 'SGD' },
  status: { type: DataTypes.ENUM('Completed', 'Failed'), defaultValue: 'Completed' },
  reference: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: { type: DataTypes.STRING },
  data: { type: DataTypes.JSON, defaultValue: {} },
  processedAt: { type: DataTypes.DATE, allowNull: false }
});

module.exports = TestBankTransaction;
