const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Invoice = sequelize.define('Invoice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  number: { type: DataTypes.STRING, allowNull: false, unique: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10,2), allowNull: false },
  status: { type: DataTypes.ENUM('Draft','Sent','Viewed','Paid','Overdue'), defaultValue: 'Draft' },
  due_date: { type: DataTypes.DATE },
  data: { type: DataTypes.JSON }
});

module.exports = Invoice;
