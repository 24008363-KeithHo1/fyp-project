const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const requireRole = require('../middlewares/roles');
const annCtrl = require('../controllers/announcementController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

router.use(auth);

// ensure upload dir exists
const ANN_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'announcements');
if (!fs.existsSync(ANN_UPLOAD_DIR)) fs.mkdirSync(ANN_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, ANN_UPLOAD_DIR),
	filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});

const upload = multer({
	storage,
	limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
	fileFilter: (req, file, cb) => {
		const ext = path.extname(file.originalname).toLowerCase();
		const allowed = ['.png','.jpg','.jpeg','.webp','.gif','.pdf','.doc','.docx','.xls','.xlsx','.csv','.txt','.ppt','.pptx'];
		if (allowed.includes(ext)) cb(null, true);
		else cb(new Error('Unsupported file type'));
	}
});

// View announcements - accessible to all authenticated roles
router.get('/', requireRole(['Admin', 'Finance', 'HR', 'Staff']), annCtrl.listPage);

// Dedicated create page for HR/Admin
router.get('/new', requireRole(['Admin', 'HR']), annCtrl.newPage);

// Create announcement - only HR and Admin. Accept up to 5 attachments.
router.post('/', requireRole(['Admin', 'HR']), upload.array('attachments', 5), annCtrl.createAnnouncement);

module.exports = router;
