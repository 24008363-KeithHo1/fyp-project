const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  invoiceId: { type: DataTypes.INTEGER, allowNull: false },
  invoiceNumber: { type: DataTypes.STRING, allowNull: false },
  // BankTransfer is retained for historical records; new UI payments use the
  // three active providers.
  method: { type: DataTypes.ENUM('Stripe', 'PayPal', 'NETS', 'BankTransfer'), allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  currency: { type: DataTypes.STRING, defaultValue: 'SGD' },
  // Added: records payment result for reports, filters, and recent activity.
  status: { type: DataTypes.ENUM('Paid', 'Failed', 'Pending', 'Refunded'), defaultValue: 'Paid' },
  providerReference: { type: DataTypes.STRING, unique: true },
  paidAt: { type: DataTypes.DATE, allowNull: false },
  recordedBy: { type: DataTypes.INTEGER },
  data: { type: DataTypes.JSON, defaultValue: {} }
});

module.exports = Payment;
