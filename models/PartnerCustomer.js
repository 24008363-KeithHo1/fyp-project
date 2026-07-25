const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const SubscriptionPlan = require('./SubscriptionPlan');

// Master customer data for the separate Partner Subscription Billing module.
// This model must not be associated with the existing Invoice or Payment models.
const PartnerCustomer = sequelize.define('PartnerCustomer', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  customerCode: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true,
    validate: { notEmpty: true }
  },
  businessName: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { notEmpty: true }
  },
  businessType: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { notEmpty: true }
  },
  contactPerson: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { notEmpty: true }
  },
  billingEmail: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { isEmail: true }
  },
  phone: { type: DataTypes.STRING(30) },
  billingAddress: { type: DataTypes.STRING(500) },
  region: { type: DataTypes.STRING(100) },
  subscriptionPlanId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: SubscriptionPlan, key: 'id' }
  },
  currency: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'SGD',
    validate: { isUppercase: true, len: [3, 10] }
  },
  billingCycle: {
    type: DataTypes.ENUM('Monthly'),
    allowNull: false,
    defaultValue: 'Monthly'
  },
  paymentTermsDays: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 14,
    validate: { min: 0, max: 365 }
  },
  subscriptionStartDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  autoBillingEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  nextBillingDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('Active', 'Suspended', 'Inactive'),
    allowNull: false,
    defaultValue: 'Active'
  },
  notes: { type: DataTypes.TEXT },
  data: { type: DataTypes.JSON, defaultValue: {} }
}, {
  tableName: 'PartnerCustomers',
  indexes: [
    { fields: ['status'] },
    { fields: ['businessType'] },
    { fields: ['billingEmail'] }
  ]
});

PartnerCustomer.belongsTo(SubscriptionPlan, {
  as: 'subscriptionPlan',
  foreignKey: 'subscriptionPlanId'
});
SubscriptionPlan.hasMany(PartnerCustomer, {
  as: 'partnerCustomers',
  foreignKey: 'subscriptionPlanId'
});

module.exports = PartnerCustomer;
