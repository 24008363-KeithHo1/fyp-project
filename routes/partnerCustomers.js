const express = require('express');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const controller = require('../controllers/partnerCustomerController');

const router = express.Router();
router.use(auth);

// Finance can view partner billing profiles and edit billing settings only.
// These routes are declared before the Admin-only master-data routes.
router.get('/billing', requireRole(['Finance']), controller.billingList);
router.patch('/:id/billing', requireRole(['Finance']), controller.updateBilling);
router.get('/plans', requireRole(['Admin', 'Finance']), controller.plans);

router.use(requireRole(['Admin']));
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);

module.exports = router;
