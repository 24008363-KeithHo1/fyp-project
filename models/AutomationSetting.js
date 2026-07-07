const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AutomationSetting = sequelize.define('AutomationSetting', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  underscored: false
});

module.exports = AutomationSetting;
