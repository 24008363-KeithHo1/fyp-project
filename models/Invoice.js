const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Invoice = sequelize.define('Invoice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  number: { type: DataTypes.STRING, allowNull: false, unique: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SGD' },
  status: { type: DataTypes.ENUM('Draft','Approved','Sent','Viewed','Paid','Overdue'), defaultValue: 'Draft' },
  paypalEmail: {
    type: DataTypes.STRING(255),
    allowNull: true,
    validate: { isEmail: true }
  },
  due_date: { type: DataTypes.DATE },
  data: { type: DataTypes.JSON }
});

module.exports = Invoice;
