const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const reqCtrl = require('../controllers/requestsController');

router.use(auth);
router.use(requireRole(['Admin']));

router.get('/users', admin.listUsers);
router.get('/invite-tokens', admin.listInviteTokens);
router.get('/password-resets', admin.listPasswordResets);
router.get('/audit-logs', admin.listAuditLogs);
router.get('/audit-logs-json', admin.listAuditLogsJson);
router.get('/users/:id/edit', admin.editUserView);
router.post('/users/:id', admin.updateUser);
router.get('/dashboard', admin.dashboardView);
router.get('/requests', reqCtrl.deptInboxPage);

module.exports = router;
