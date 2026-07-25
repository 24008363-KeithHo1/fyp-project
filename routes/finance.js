const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const reqCtrl = require('../controllers/requestsController');
const payrollApproval = require('../controllers/payrollApprovalController');
const subscriptionInvoices = require('../controllers/subscriptionInvoiceController');

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

router.get('/requests', reqCtrl.deptInboxPage);
router.get('/payroll-approvals', payrollApproval.listPage);
router.get('/payroll-approvals/:id', payrollApproval.detailPage);
router.post('/payroll-approvals/:id/approve', payrollApproval.approve);
router.post('/payroll-approvals/:id/reject', payrollApproval.reject);
router.get('/subscription-invoices', requireRole(['Finance']), subscriptionInvoices.reviewPage);

module.exports = router;
