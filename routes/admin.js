const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const reqCtrl = require('../controllers/requestsController');

router.use(auth);
router.use(requireRole(['Admin']));

router.get('/users', admin.listUsers);
router.get('/automation', admin.automationPage);
router.get('/automation/history', admin.reminderHistory);
router.post('/automation/settings', admin.saveAutomationSettings);
router.post('/automation/period', admin.savePayrollPeriod);
router.post('/automation/period/:id/advance', admin.advancePayrollPeriod);
router.post('/automation/run', admin.triggerAutomation);
router.get('/audit-logs', admin.listAuditLogs);
router.get('/audit-logs-json', admin.listAuditLogsJson);
router.get('/users/:id/edit', admin.editUserView);
router.post('/users/:id', admin.updateUser);
router.get('/dashboard', admin.dashboardView);
router.get('/requests', reqCtrl.deptInboxPage);

module.exports = router;
