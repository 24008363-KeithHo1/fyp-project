const express = require('express');
const controller = require('../controllers/subscriptionPaymentController');

const router = express.Router();
router.post('/:token/stripe-checkout', controller.createStripeCheckout);
router.get('/stripe/success', controller.stripeSuccess);

module.exports = router;
