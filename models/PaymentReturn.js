const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const PaymentReturn = sequelize.define('PaymentReturn', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  originalPaymentId: { type: DataTypes.INTEGER, allowNull: false },
  invoiceId: { type: DataTypes.INTEGER, allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: false },
  remarks: { type: DataTypes.TEXT },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  currency: { type: DataTypes.STRING(10), defaultValue: 'SGD' },
  supplierEmail: { type: DataTypes.STRING(255), allowNull: false },
  requestedBy: { type: DataTypes.INTEGER },
  requestedAt: { type: DataTypes.DATE, allowNull: false },
  status: {
    type: DataTypes.ENUM('ReturnRequested', 'Returned'),
    allowNull: false,
    defaultValue: 'ReturnRequested'
  },
  confirmedBy: { type: DataTypes.INTEGER },
  confirmedAt: { type: DataTypes.DATE },
  returnTransactionId: { type: DataTypes.INTEGER },
  notificationEmail: { type: DataTypes.STRING(255) },
  notificationStatus: {
    type: DataTypes.ENUM('Pending', 'Sent', 'Failed'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  notificationSentAt: { type: DataTypes.DATE },
  notificationError: { type: DataTypes.TEXT },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  indexes: [
    {
      unique: true,
      fields: ['originalPaymentId'],
      name: 'uniq_payment_return_original_payment'
    },
    { fields: ['invoiceId', 'status'], name: 'idx_payment_returns_invoice_status' }
  ]
});

module.exports = PaymentReturn;
