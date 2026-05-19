const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');

router.use(auth);
router.use(requireRole(['Admin', 'Finance']));

router.get('/dashboard', (req, res) => {
  res.render('finance/dashboard');
});

router.get('/payments', (req, res) => {
  res.render('finance/payments');
});

router.get('/bank-reconcile', (req, res) => {
  res.render('finance/bank-reconcile');
});

module.exports = router;
