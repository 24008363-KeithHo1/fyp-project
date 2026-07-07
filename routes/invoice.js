const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');
const ctrl = require('../controllers/invoiceController');

router.post('/', auth, checkRole(['Admin','Finance']), ctrl.create);
router.post('/bulk-upload', auth, checkRole(['Admin','Finance']), ctrl.bulkUploadMiddleware, ctrl.bulkUpload);
router.get('/', auth, checkRole(['Admin','Finance','HR']), ctrl.list);
// Same roles as the list endpoint: any role that can browse invoices can
// also open, PDF-export, or Excel-export an individual one. Staff have no
// business role here, so without this check any authenticated Staff user
// could view/export any invoice just by guessing/incrementing its id.
router.get('/:id', auth, checkRole(['Admin','Finance','HR']), ctrl.get);
router.get('/:id/pdf', auth, checkRole(['Admin','Finance','HR']), ctrl.exportPdf);
router.get('/:id/excel', auth, checkRole(['Admin','Finance','HR']), ctrl.exportExcel);
router.post('/:id/send', auth, checkRole(['Admin','Finance']), ctrl.send);
// Public view link (tokenized) -- does not require auth
router.get('/:id/view', ctrl.viewPage);

module.exports = router;
