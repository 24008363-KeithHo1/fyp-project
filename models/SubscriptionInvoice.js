const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const PartnerCustomer = require('./PartnerCustomer');
const SubscriptionPlan = require('./SubscriptionPlan');
const { SUBSCRIPTION_INVOICE_STATUSES } = require('../services/subscriptionInvoiceLifecycle');

// Independent invoice header for monthly partner subscriptions.
// Do not associate this model with the existing Invoice or Payment models.
const SubscriptionInvoice = sequelize.define('SubscriptionInvoice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  number: {
    type: DataTypes.STRING(40),
    allowNull: false,
    unique: true
  },
  partnerCustomerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: PartnerCustomer, key: 'id' }
  },
  subscriptionPlanId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: SubscriptionPlan, key: 'id' }
  },

  // Immutable customer and plan snapshots used by historical invoices.
  customerCodeSnapshot: { type: DataTypes.STRING(30), allowNull: false },
  businessNameSnapshot: { type: DataTypes.STRING(255), allowNull: false },
  billingEmailSnapshot: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { isEmail: true }
  },
  planCodeSnapshot: { type: DataTypes.STRING(30), allowNull: false },
  planNameSnapshot: { type: DataTypes.STRING(100), allowNull: false },
  planFeaturesSnapshot: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  description: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Monthly Subscription Fee'
  },
  subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'SGD' },

  billingPeriodStart: { type: DataTypes.DATEONLY, allowNull: false },
  billingPeriodEnd: { type: DataTypes.DATEONLY, allowNull: false },
  invoiceDate: { type: DataTypes.DATEONLY, allowNull: false },
  dueDate: { type: DataTypes.DATEONLY, allowNull: false },
  paymentTermsDaysSnapshot: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

  status: {
    type: DataTypes.ENUM(...SUBSCRIPTION_INVOICE_STATUSES),
    allowNull: false,
    defaultValue: 'Draft'
  },
  publicToken: { type: DataTypes.STRING(128), unique: true },
  approvedBy: { type: DataTypes.INTEGER },
  approvedAt: { type: DataTypes.DATE },
  rejectedBy: { type: DataTypes.INTEGER },
  rejectedAt: { type: DataTypes.DATE },
  rejectionReason: { type: DataTypes.TEXT },
  sentAt: { type: DataTypes.DATE },
  viewedAt: { type: DataTypes.DATE },
  paymentPendingAt: { type: DataTypes.DATE },
  paidAt: { type: DataTypes.DATE },
  paymentFailedAt: { type: DataTypes.DATE },
  overdueAt: { type: DataTypes.DATE },
  refundedAt: { type: DataTypes.DATE },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'SubscriptionInvoices',
  indexes: [
    {
      unique: true,
      name: 'subscription_invoice_customer_period_unique',
      fields: ['partnerCustomerId', 'billingPeriodStart', 'billingPeriodEnd']
    },
    { fields: ['status'] },
    { fields: ['dueDate'] },
    { fields: ['partnerCustomerId'] }
  ],
  validate: {
    billingDatesAreChronological() {
      const start = new Date(this.billingPeriodStart);
      const end = new Date(this.billingPeriodEnd);
      const invoiceDate = new Date(this.invoiceDate);
      const dueDate = new Date(this.dueDate);
      if (start > end) throw new Error('Billing period start must be on or before billing period end.');
      if (invoiceDate > dueDate) throw new Error('Invoice date must be on or before due date.');
    },
    totalsAreConsistent() {
      const expected = Number(this.subtotal) + Number(this.taxAmount || 0);
      if (Math.abs(expected - Number(this.totalAmount)) > 0.009) {
        throw new Error('Subscription invoice total must equal subtotal plus tax.');
      }
    }
  }
});

SubscriptionInvoice.belongsTo(PartnerCustomer, {
  as: 'partnerCustomer',
  foreignKey: 'partnerCustomerId'
});
SubscriptionInvoice.belongsTo(SubscriptionPlan, {
  as: 'subscriptionPlan',
  foreignKey: 'subscriptionPlanId'
});

module.exports = SubscriptionInvoice;
