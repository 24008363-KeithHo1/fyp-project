const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

// Persistent, one-time Finance demonstration schedule. This does not modify
// the production month-end cron configuration.
const SubscriptionDemoSchedule = sequelize.define('SubscriptionDemoSchedule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  billingPeriod: { type: DataTypes.STRING(7), allowNull: false },
  scheduledFor: { type: DataTypes.DATE, allowNull: false },
  timezone: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'Asia/Singapore' },
  status: {
    type: DataTypes.ENUM('Scheduled', 'Running', 'Completed', 'Failed', 'Cancelled'),
    allowNull: false,
    defaultValue: 'Scheduled'
  },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
  automationRunId: { type: DataTypes.INTEGER },
  startedAt: { type: DataTypes.DATE },
  completedAt: { type: DataTypes.DATE },
  errorMessage: { type: DataTypes.TEXT },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionDemoSchedules',
  indexes: [
    { fields: ['status', 'scheduledFor'] },
    { fields: ['createdBy', 'createdAt'] }
  ]
});

module.exports = SubscriptionDemoSchedule;
