const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const admin = require('../controllers/adminController');
const reqCtrl = require('../controllers/requestsController');
const dashboardCtrl = require('../controllers/hrDashboardController');

router.use(auth);
router.use(requireRole(['Admin', 'HR']));

router.get('/dashboard', (req, res) => {
  res.render('hr/dashboard');
});
router.get('/summary', dashboardCtrl.summary);

router.get('/automation', requireRole(['HR']), admin.automationPage);
router.get('/automation/history', requireRole(['HR']), admin.reminderHistory);
router.post('/automation/settings', requireRole(['HR']), admin.saveAutomationSettings);
router.post('/automation/period', requireRole(['HR']), admin.savePayrollPeriod);
router.post('/automation/period/:id/advance', requireRole(['HR']), admin.advancePayrollPeriod);
router.post('/automation/run', requireRole(['HR']), admin.triggerAutomation);

router.get('/employees', admin.listUsersByDepartment);

router.get('/requests', reqCtrl.deptInboxPage);

module.exports = router;
