const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Payroll = sequelize.define('Payroll', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false },
  bank_number: { type: DataTypes.STRING },
  period: { type: DataTypes.STRING, allowNull: false },
  gross: { type: DataTypes.DECIMAL(10,2) },
  deductions: { type: DataTypes.JSON, defaultValue: {} },
  net: { type: DataTypes.DECIMAL(10,2) },
  payment_status: { type: DataTypes.ENUM('Pending', 'Approved', 'Paid'), defaultValue: 'Pending' },
  paid_at: { type: DataTypes.DATE },
  payment_method: { type: DataTypes.STRING },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  timestamps: true,
  underscored: false
});

module.exports = Payroll;
