const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/config');
const User = require('../models/User');

module.exports = async function (req, res, next) {
  const auth = req.headers.authorization;
  let token = null;
  if (req.headers.authorization){
    token = req.headers.authorization.split(' ')[1];
  } else if (req.headers.cookie){
    const m = req.headers.cookie.match(/(?:^|; )token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findByPk(payload.id);  // Remove include: ['role'] since role is now direct field
    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
