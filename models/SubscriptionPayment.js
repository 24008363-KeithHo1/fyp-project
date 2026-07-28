const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('./SubscriptionInvoice');

// Payment ledger dedicated to partner subscription invoices. It deliberately
// has no association with the legacy Invoice or Payment models.
const SubscriptionPayment = sequelize.define('SubscriptionPayment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  subscriptionInvoiceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: SubscriptionInvoice, key: 'id' }
  },
  provider: {
    type: DataTypes.ENUM('Stripe'),
    allowNull: false,
    defaultValue: 'Stripe'
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Paid', 'Failed', 'Refunded'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  expectedAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  receivedAmount: { type: DataTypes.DECIMAL(10, 2) },
  currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SGD' },
  invoicePaymentKey: { type: DataTypes.STRING(80), unique: true },
  checkoutSessionId: { type: DataTypes.STRING(255), unique: true },
  providerReference: { type: DataTypes.STRING(255), unique: true },
  attemptedAt: { type: DataTypes.DATE, allowNull: false },
  paidAt: { type: DataTypes.DATE },
  failedAt: { type: DataTypes.DATE },
  failureReason: { type: DataTypes.TEXT },
  refundedAt: { type: DataTypes.DATE },
  refundReference: { type: DataTypes.STRING(255), unique: true },
  refundAmount: { type: DataTypes.DECIMAL(10, 2) },
  refundReason: { type: DataTypes.TEXT },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionPayments',
  indexes: [
    { fields: ['subscriptionInvoiceId', 'status'] },
    { fields: ['provider', 'attemptedAt'] }
  ]
});

SubscriptionInvoice.hasMany(SubscriptionPayment, {
  as: 'subscriptionPayments',
  foreignKey: 'subscriptionInvoiceId',
  onDelete: 'RESTRICT'
});
SubscriptionPayment.belongsTo(SubscriptionInvoice, {
  as: 'subscriptionInvoice',
  foreignKey: 'subscriptionInvoiceId'
});

module.exports = SubscriptionPayment;
