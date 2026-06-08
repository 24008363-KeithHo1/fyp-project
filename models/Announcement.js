const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');

const Announcement = sequelize.define('Announcement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
  attachments: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  timestamps: true,
});

Announcement.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });

module.exports = Announcement;
