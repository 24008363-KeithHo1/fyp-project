const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const reqCtrl = require('../controllers/requestsController');

router.use(auth);
router.use(requireRole(['Admin', 'HR']));

router.get('/dashboard', (req, res) => {
  res.render('hr/dashboard');
});

router.get('/requests', reqCtrl.deptInboxPage);

module.exports = router;
