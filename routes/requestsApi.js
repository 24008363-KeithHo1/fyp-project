const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const ctrl = require('../controllers/requestsController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'requests');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({ storage });

router.post('/', auth, requireRole(['Admin', 'Staff']), upload.array('attachments', 8), ctrl.create);
router.get('/', auth, ctrl.list);
router.get('/:id', auth, ctrl.get);
router.put('/:id/status', auth, requireRole(['Admin', 'HR', 'Finance']), ctrl.updateStatus);

module.exports = router;
