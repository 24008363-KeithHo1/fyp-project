const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

// Fixed plan catalogue for the separate Partner Subscription Billing module.
const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: {
    type: DataTypes.ENUM('BASIC', 'STANDARD', 'PREMIUM'),
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.ENUM('Basic', 'Standard', 'Premium'),
    allowNull: false,
    unique: true
  },
  monthlyFee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 0 }
  },
  currency: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'SGD'
  },
  features: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'SubscriptionPlans'
});

module.exports = SubscriptionPlan;
