const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const auth = require('../middlewares/auth');

router.use(auth);
router.use(admin.ensureAdmin);

router.get('/users', admin.listUsers);
router.get('/users/:id/edit', admin.editUserView);
router.post('/users/:id', admin.updateUser);

module.exports = router;
