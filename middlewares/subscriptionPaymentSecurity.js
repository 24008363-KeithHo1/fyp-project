const rateLimit = require('express-rate-limit');

const publicInvoiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many subscription invoice requests. Please try again later.'
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please wait before trying again.' }
});

module.exports = {
  publicInvoiceLimiter,
  checkoutLimiter
};
