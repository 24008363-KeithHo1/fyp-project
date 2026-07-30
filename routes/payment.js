const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');

const paymentController = require('../controllers/paymentController');

// Payment routes added for the different payment flows used by invoices and the finance page.
router.post('/checkout/:id', paymentController.createCheckoutSession);
router.get('/paypal/config', paymentController.paypalConfig);
router.post('/paypal/orders/:id', paymentController.createPayPalOrder);
router.post('/paypal/orders/:orderId/capture', paymentController.capturePayPalOrder);
// Supplier payout routes are protected because they send outgoing money from
// the Business PayPal sandbox account to a supplier Personal sandbox account.
router.post('/paypal/payouts/:id', auth, checkRole(['Admin', 'Finance']), paymentController.createSupplierPayout);
router.post('/paypal/payouts/:id/status', auth, checkRole(['Admin', 'Finance']), paymentController.checkSupplierPayoutStatus);
router.get('/nets/:id/status/:txnRetrievalRef', paymentController.netsPaymentStatus);
router.get('/nets/:id/page', paymentController.netsQrPage);
router.get('/nets/:id', paymentController.netsQr);
router.post('/nets/:id/complete', paymentController.completeNETSPayment);
router.post('/nets/:id/confirm', auth, checkRole(['Admin', 'Finance']), paymentController.confirmNETSPayment);
router.get('/history', auth, checkRole(['Admin', 'Finance']), paymentController.history);
router.delete('/history/:id', auth, checkRole(['Admin', 'Finance']), paymentController.removeHistoryItem);
router.post('/:id/refund', auth, checkRole(['Admin', 'Finance']), paymentController.refundPayment);

// Stripe redirects users here after checkout success or cancellation.
router.get('/success', paymentController.handleSuccess);

router.get('/cancel', (req, res) => {
  res.send('Payment cancelled.');
});

module.exports = router;
