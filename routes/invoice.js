const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');
const ctrl = require('../controllers/invoiceController');
const crypto = require('crypto');
const Invoice = require('../models/Invoice');

/**
 * Lets a customer who received the tokenized "view" link download the
 * PDF/Excel without logging in — same trust level as viewPage(). If the
 * query token doesn't match, falls through to normal staff auth+role
 * checks instead of failing outright, so logged-in Admin/Finance/HR users
 * can still use these routes exactly as before with no token at all.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function allowViewTokenOrStaffAuth(req, res, next) {
  const token = req.query.token;
  if (token) {
    const inv = await Invoice.findByPk(req.params.id);
    const expectedToken = inv && inv.data && inv.data.view_token;
    if (expectedToken && safeEqual(String(token), String(expectedToken))) {
      return next(); // valid view token — skip staff auth entirely
    }
    // token was supplied but didn't match — fail closed rather than
    // silently falling back to staff auth, since a wrong/expired token
    // is more likely a mistake or tampering than a staff member forgetting
    // to log in.
    return res.status(403).json({ error: 'Invalid or missing view token' });
  }
  // no token supplied at all — require normal staff login+role instead
  return auth(req, res, (err) => {
    if (err) return next(err);
    checkRole(['Admin','Finance','HR'])(req, res, next);
  });
}

router.post('/', auth, checkRole(['Admin','Finance']), ctrl.create);
router.post('/bulk-upload', auth, checkRole(['Admin','Finance']), ctrl.bulkUploadMiddleware, ctrl.bulkUpload);
router.get('/', auth, checkRole(['Admin','Finance','HR']), ctrl.list);
// Same roles as the list endpoint: any role that can browse invoices can
// also open, PDF-export, or Excel-export an individual one. Staff have no
// business role here, so without this check any authenticated Staff user
// could view/export any invoice just by guessing/incrementing its id.
router.get('/:id', auth, checkRole(['Admin','Finance','HR']), ctrl.get);
router.get('/:id/pdf', allowViewTokenOrStaffAuth, ctrl.exportPdf);
router.get('/:id/excel', allowViewTokenOrStaffAuth, ctrl.exportExcel);
router.post('/:id/send', auth, checkRole(['Admin','Finance']), ctrl.send);
router.delete('/:id', auth, checkRole(['Admin','Finance']), ctrl.remove);
// Public view link (tokenized) -- does not require auth
router.get('/:id/view', ctrl.viewPage);

module.exports = router;