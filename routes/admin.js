const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const reqCtrl = require('../controllers/requestsController');

router.use(auth);
router.use(requireRole(['Admin']));

router.get('/users', admin.listUsers);
router.get('/audit-logs', admin.listAuditLogs);
router.get('/audit-logs-json', admin.listAuditLogsJson);
router.get('/users/:id/edit', admin.editUserView);
router.post('/users/:id', admin.updateUser);
router.post('/users/:id/reset-mfa', admin.resetUserMfa);
router.get('/dashboard', admin.dashboardView);
router.get('/requests', reqCtrl.deptInboxPage);
router.get('/register', (req, res) => {
  res.render('register', { token: '', email: '', title: 'Create User Account', adminWorkspace: true });
});
router.get('/reset', (req, res) => {
  res.render('reset', { token: req.query.token || '', title: 'Password Reset', adminWorkspace: true });
});

module.exports = router;
