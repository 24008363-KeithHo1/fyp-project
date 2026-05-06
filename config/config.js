module.exports = {
  jwtSecret: process.env.JWT_SECRET || 'CHANGE_THIS_SECRET',
  jwtExpiry: process.env.JWT_EXPIRES_IN || '8h',
  stripeSecret: process.env.STRIPE_SECRET || '',
};
