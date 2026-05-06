const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/db');
const Role = require('../models/Role');
const User = require('../models/User');

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');
    await sequelize.sync();

    const roles = ['Admin','Finance','HR','Staff'];
    for (const name of roles) {
      await Role.findOrCreate({ where: { name } });
    }

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'paul@paul.com';
    const adminPass = process.env.SEED_ADMIN_PASS || '123456';

    const [adminRole] = await Role.findOrCreate({ where: { name: 'Admin' } });

    const existing = await User.findOne({ where: { email: adminEmail } });
    if (existing) {
      console.log('Admin user already exists:', adminEmail);
      process.exit(0);
    }

    const hash = await bcrypt.hash(adminPass, 10);
    const user = await User.create({ name: 'Seed Admin', email: adminEmail, password: hash, RoleId: adminRole.id, isActive: true, isVerified: true });
    console.log('Created admin user:', user.email);
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed', err);
    process.exit(1);
  }
}

seed();
