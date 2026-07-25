const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionInvoice = require('./SubscriptionInvoice');

const SubscriptionInvoiceItem = sequelize.define('SubscriptionInvoiceItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  subscriptionInvoiceId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: SubscriptionInvoice, key: 'id' }
  },
  lineNumber: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  description: { type: DataTypes.STRING(255), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
  unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  lineAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionInvoiceItems',
  indexes: [
    {
      unique: true,
      name: 'subscription_invoice_item_line_unique',
      fields: ['subscriptionInvoiceId', 'lineNumber']
    }
  ],
  validate: {
    lineAmountIsConsistent() {
      const expected = Number(this.quantity) * Number(this.unitPrice);
      if (Math.abs(expected - Number(this.lineAmount)) > 0.009) {
        throw new Error('Subscription invoice line amount must equal quantity multiplied by unit price.');
      }
    }
  }
});

SubscriptionInvoice.hasMany(SubscriptionInvoiceItem, {
  as: 'items',
  foreignKey: 'subscriptionInvoiceId',
  onDelete: 'CASCADE'
});
SubscriptionInvoiceItem.belongsTo(SubscriptionInvoice, {
  as: 'subscriptionInvoice',
  foreignKey: 'subscriptionInvoiceId'
});

module.exports = SubscriptionInvoiceItem;
