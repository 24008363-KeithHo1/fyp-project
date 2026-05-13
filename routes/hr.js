const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');

router.use(auth);
router.use(requireRole(['Admin', 'HR']));

router.get('/dashboard', (req, res) => {
  res.render('hr/dashboard');
});

module.exports = router;
