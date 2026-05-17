const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');
const ctrl = require('../controllers/invoiceController');

router.post('/', auth, checkRole(['Admin','Finance']), ctrl.create);
router.get('/', auth, checkRole(['Admin','Finance','HR']), ctrl.list);
router.get('/:id', auth, ctrl.get);
router.get('/:id/pdf', auth, ctrl.exportPdf);
router.get('/:id/excel', auth, ctrl.exportExcel);
router.post('/:id/send', auth, checkRole(['Admin','Finance']), ctrl.send);
// Public view link (tokenized) -- does not require auth
router.get('/:id/view', ctrl.viewPage);

module.exports = router;
