const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ReminderDelivery = sequelize.define('ReminderDelivery', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  payrollPeriodId: { type: DataTypes.INTEGER, allowNull: true },
  reminderKey: { type: DataTypes.STRING, allowNull: false },
  deadline: { type: DataTypes.DATEONLY, allowNull: false },
  recipient: { type: DataTypes.STRING, allowNull: false },
  status: {
    type: DataTypes.ENUM('sent', 'failed', 'skipped'),
    allowNull: false
  },
  source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'scheduler' },
  sentAt: { type: DataTypes.DATE, allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true }
}, {
  indexes: [{
    unique: true,
    fields: ['payrollPeriodId', 'reminderKey', 'deadline', 'recipient'],
    name: 'reminder_delivery_unique_recipient'
  }]
});

module.exports = ReminderDelivery;
