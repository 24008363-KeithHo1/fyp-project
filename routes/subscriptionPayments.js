const express = require('express');
const controller = require('../controllers/subscriptionPaymentController');
const {
  publicInvoiceLimiter,
  checkoutLimiter
} = require('../middlewares/subscriptionPaymentSecurity');

const router = express.Router();
router.get('/:token/receipt', publicInvoiceLimiter, controller.publicReceipt);
router.post('/:token/stripe-checkout', checkoutLimiter, controller.createStripeCheckout);
router.get('/stripe/success', controller.stripeSuccess);

module.exports = router;
