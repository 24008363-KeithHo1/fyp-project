const express = require('express');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const controller = require('../controllers/subscriptionInvoiceController');
const subscriptionPaymentController = require('../controllers/subscriptionPaymentController');

const router = express.Router();
router.use(auth);
router.use(requireRole(['Finance']));

router.get('/generation-preview', controller.previewGeneration);
router.post('/generate-drafts', controller.generateDrafts);
router.post('/demo-generate', controller.generateDemoNow);
router.get('/demo-schedules', controller.demoSchedules);
router.post('/demo-schedules', controller.scheduleDemo);
router.get('/automation-runs', controller.automationHistory);
router.get('/payments', controller.paymentHistory);
router.get('/revenue-report', controller.revenueReport);
router.get('/revenue-export.csv', controller.revenueExport);
router.post('/payments/bank-transfer', subscriptionPaymentController.recordBankTransfer);
router.post('/payments/:paymentId/reconcile', subscriptionPaymentController.reconcileStripePayment);
router.post('/payments/:paymentId/refund', subscriptionPaymentController.refundStripePayment);
router.get('/payments/:paymentId/receipt', subscriptionPaymentController.financeReceipt);
router.get('/overdue-preview', controller.overduePreview);
router.post('/overdue-check', controller.runOverdueCheck);
router.get('/reminder-preview', controller.reminderPreview);
router.post('/send-reminders', controller.sendReminders);
router.get('/', controller.list);
router.patch('/:id/draft', controller.updateDraft);
router.post('/:id/reject', controller.rejectDraft);
router.post('/:id/approve', controller.approveDraft);
router.post('/:id/send', controller.sendApproved);
router.get('/:id/pdf', controller.pdf);
router.get('/:id', controller.get);

module.exports = router;
