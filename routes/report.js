const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');
const ctrl = require('../controllers/reportController');

router.use(auth);
router.use(checkRole(['Admin', 'Finance', 'HR']));

router.get('/summary', ctrl.summary);
router.get('/validation', ctrl.validation);

module.exports = router;
