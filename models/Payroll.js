const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Payroll = sequelize.define('Payroll', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  employee_name: { type: DataTypes.STRING, allowNull: false },
  employee_email: { type: DataTypes.STRING, allowNull: false },
  period: { type: DataTypes.STRING },
  gross: { type: DataTypes.DECIMAL(10,2) },
  allowances: { type: DataTypes.JSON, defaultValue: {} },
  deductions: { type: DataTypes.JSON, defaultValue: {} },
  net: { type: DataTypes.DECIMAL(10,2) },
  data: { type: DataTypes.JSON }
});

module.exports = Payroll;
