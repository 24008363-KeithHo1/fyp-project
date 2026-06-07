const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');

const paymentController = require('../controllers/paymentController');

router.post('/checkout/:id', paymentController.createCheckoutSession);
router.get('/paypal/config', paymentController.paypalConfig);
router.post('/paypal/orders/:id', paymentController.createPayPalOrder);
router.post('/paypal/orders/:orderId/capture', paymentController.capturePayPalOrder);
router.get('/paynow/:id', paymentController.payNowQr);
router.get('/bank-transfer/:id', paymentController.bankTransferInstructions);
router.post('/bank-transfer/:id/confirm', auth, checkRole(['Admin', 'Finance']), paymentController.confirmBankTransfer);
router.get('/history', auth, checkRole(['Admin', 'Finance']), paymentController.history);

router.get('/success', paymentController.handleSuccess);

router.get('/cancel', (req, res) => {
  res.send('Payment cancelled.');
});

module.exports = router;
