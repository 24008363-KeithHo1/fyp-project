const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER },
  action: { type: DataTypes.STRING },
  entity: { type: DataTypes.STRING },
  entityId: { type: DataTypes.INTEGER },
  meta: { type: DataTypes.JSON },
  ip: { type: DataTypes.STRING },
  userAgent: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { timestamps: false });

module.exports = AuditLog;
