const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const InviteToken = sequelize.define('InviteToken', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  token: { type: DataTypes.STRING, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false },
  expiresAt: { type: DataTypes.DATE },
  used: { type: DataTypes.BOOLEAN, defaultValue: false },
  inviterId: { type: DataTypes.INTEGER }
});

module.exports = InviteToken;
