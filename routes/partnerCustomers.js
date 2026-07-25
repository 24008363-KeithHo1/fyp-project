const express = require('express');
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const controller = require('../controllers/partnerCustomerController');

const router = express.Router();
router.use(auth);
router.use(requireRole(['Admin']));

router.get('/plans', controller.plans);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.patch('/:id/status', controller.setStatus);

module.exports = router;
