const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Payroll = sequelize.define('Payroll', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  employee_name: { type: DataTypes.STRING, allowNull: false },
  employee_email: { type: DataTypes.STRING, allowNull: false },
  period: { type: DataTypes.STRING, allowNull: false },
  gross: { type: DataTypes.DECIMAL(10,2) },
  deductions: { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },
  net: { type: DataTypes.DECIMAL(10,2) }
}, {
  timestamps: true,
  underscored: false
});

module.exports = Payroll;
