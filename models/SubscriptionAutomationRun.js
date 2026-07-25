const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

// Execution history for the separate subscription billing automation.
const SubscriptionAutomationRun = sequelize.define('SubscriptionAutomationRun', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  runKey: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  type: {
    type: DataTypes.ENUM('MonthlyInvoiceGeneration'),
    allowNull: false,
    defaultValue: 'MonthlyInvoiceGeneration'
  },
  billingPeriod: { type: DataTypes.STRING(7), allowNull: false },
  triggerSource: {
    type: DataTypes.ENUM('Scheduler', 'FinanceRecovery'),
    allowNull: false
  },
  triggeredBy: { type: DataTypes.INTEGER },
  status: {
    type: DataTypes.ENUM('Running', 'Success', 'Partial', 'Failed'),
    allowNull: false,
    defaultValue: 'Running'
  },
  scheduledFor: { type: DataTypes.DATE },
  startedAt: { type: DataTypes.DATE, allowNull: false },
  completedAt: { type: DataTypes.DATE },
  eligibleCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  generatedCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  skippedCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  failedCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  totalAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SGD' },
  errorMessage: { type: DataTypes.TEXT },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionAutomationRuns',
  indexes: [
    { fields: ['type', 'billingPeriod'] },
    { fields: ['status', 'startedAt'] }
  ]
});

module.exports = SubscriptionAutomationRun;
