const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');

router.use(auth);
router.use(requireRole(['Admin', 'Staff']));

router.get('/dashboard', (req, res) => {
  res.render('staff/dashboard');
});

module.exports = router;
