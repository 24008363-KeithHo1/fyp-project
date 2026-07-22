const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkRole = require('../middlewares/roles');
const ctrl = require('../controllers/payrollController');

router.post('/upload', auth, checkRole(['Admin','HR']), ctrl.uploadMiddleware, ctrl.upload);
router.get('/', auth, checkRole(['Admin','HR','Finance']), ctrl.list);
router.put('/:id', auth, checkRole(['Admin','HR']), ctrl.update);
router.delete('/:id', auth, checkRole(['Admin','HR']), ctrl.remove);
router.post('/:id/approve', auth, checkRole(['Admin','Finance']), ctrl.approvePayroll);
router.post('/:id/release', auth, checkRole(['Admin','Finance']), ctrl.releaseSalary);
router.get('/myslips', auth, ctrl.myslips);
router.get('/:id', auth, ctrl.get);
router.get('/:id/payslip', auth, ctrl.payslip);

module.exports = router;
