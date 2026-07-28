const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('./SubscriptionInvoice');

const SubscriptionEmailDelivery = sequelize.define('SubscriptionEmailDelivery', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  subscriptionInvoiceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: SubscriptionInvoice, key: 'id' }
  },
  emailType: {
    type: DataTypes.ENUM('Invoice', 'Reminder', 'Receipt'),
    allowNull: false,
    defaultValue: 'Invoice'
  },
  reminderKey: { type: DataTypes.STRING(80) },
  recipient: { type: DataTypes.STRING(255), allowNull: false },
  subject: { type: DataTypes.STRING(255), allowNull: false },
  status: {
    type: DataTypes.ENUM('Pending', 'Sent', 'Delivered', 'Failed', 'Skipped'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  messageId: { type: DataTypes.STRING(255) },
  attemptedAt: { type: DataTypes.DATE, allowNull: false },
  sentAt: { type: DataTypes.DATE },
  deliveredAt: { type: DataTypes.DATE },
  failedAt: { type: DataTypes.DATE },
  errorMessage: { type: DataTypes.TEXT },
  triggeredBy: { type: DataTypes.INTEGER },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionEmailDeliveries',
  indexes: [
    { fields: ['subscriptionInvoiceId', 'emailType'] },
    { unique: true, fields: ['subscriptionInvoiceId', 'emailType', 'reminderKey'] },
    { fields: ['status', 'attemptedAt'] },
    { fields: ['recipient'] }
  ]
});

SubscriptionInvoice.hasMany(SubscriptionEmailDelivery, {
  as: 'emailDeliveries',
  foreignKey: 'subscriptionInvoiceId',
  onDelete: 'CASCADE'
});
SubscriptionEmailDelivery.belongsTo(SubscriptionInvoice, {
  as: 'subscriptionInvoice',
  foreignKey: 'subscriptionInvoiceId'
});

module.exports = SubscriptionEmailDelivery;
