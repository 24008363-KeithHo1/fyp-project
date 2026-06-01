const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Request = sequelize.define('Request', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  senderId: { type: DataTypes.INTEGER, allowNull: false },
  senderName: { type: DataTypes.STRING, allowNull: true },
  recipient: { type: DataTypes.ENUM('HR','Finance','Admin'), allowNull: false },
  status: { type: DataTypes.ENUM('Pending','Completed','Incomplete'), defaultValue: 'Pending' },
  data: { type: DataTypes.JSON }
});

module.exports = Request;
