const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');

const paymentController = require('../controllers/paymentController');

router.post('/checkout/:id', paymentController.createCheckoutSession);
router.get('/bank-transfer/:id', paymentController.bankTransferInstructions);
router.post('/bank-transfer/:id/confirm', auth, checkRole(['Admin', 'Finance']), paymentController.confirmBankTransfer);
router.get('/history', auth, checkRole(['Admin', 'Finance']), paymentController.history);

router.get('/success', (req, res) => {
  res.send('Payment successful. You may close this page.');
});

router.get('/cancel', (req, res) => {
  res.send('Payment cancelled.');
});

module.exports = router;
