const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const PasswordResetToken = sequelize.define('PasswordResetToken', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  token: { type: DataTypes.STRING, allowNull: false, unique: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  expiresAt: { type: DataTypes.DATE },
  used: { type: DataTypes.BOOLEAN, defaultValue: false }
});

module.exports = PasswordResetToken;
