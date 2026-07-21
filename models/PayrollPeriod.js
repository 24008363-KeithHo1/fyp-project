const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const PayrollPeriod = sequelize.define('PayrollPeriod', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  periodStart: { type: DataTypes.DATEONLY, allowNull: false },
  periodEnd: { type: DataTypes.DATEONLY, allowNull: false },
  payrollUploadDeadline: { type: DataTypes.DATEONLY, allowNull: false },
  financeApprovalDeadline: { type: DataTypes.DATEONLY, allowNull: false },
  salaryReleaseDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: {
    type: DataTypes.ENUM('Draft', 'PayrollUploaded', 'PendingApproval', 'Approved', 'Released', 'Closed'),
    allowNull: false,
    defaultValue: 'Draft'
  },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  indexes: [{ fields: ['isActive'] }, { fields: ['periodStart', 'periodEnd'] }]
});

module.exports = PayrollPeriod;
