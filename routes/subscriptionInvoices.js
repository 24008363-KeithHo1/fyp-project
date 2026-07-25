const express = require('express');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const controller = require('../controllers/subscriptionInvoiceController');

const router = express.Router();
router.use(auth);
router.use(requireRole(['Finance']));

router.get('/generation-preview', controller.previewGeneration);
router.post('/generate-drafts', controller.generateDrafts);

module.exports = router;
