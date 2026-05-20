const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const InvoiceItem = sequelize.define('InvoiceItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  invoiceId: { type: DataTypes.INTEGER, allowNull: false },
  line_no: { type: DataTypes.INTEGER, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: false },
  qty: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  discount_rate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
  tax_rate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
  line_subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  line_discount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  line_tax: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  line_total: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
});

module.exports = InvoiceItem;
