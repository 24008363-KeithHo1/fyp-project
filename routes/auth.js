const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');

router.post('/register', auth.register);
router.post('/login', auth.loginLimiter, auth.login);
router.get('/me', require('../middlewares/auth'), auth.me);
router.post('/profile', require('../middlewares/auth'), auth.profileUploadMiddleware, auth.updateProfile);
router.post('/request-reset', auth.passwordResetLimiter, auth.requestPasswordReset);
router.post('/reset', auth.resetPassword);
router.post('/mfa/verify', auth.mfaVerifyLimiter, auth.mfaVerify);
router.post('/mfa/setup', require('../middlewares/auth'), auth.mfaSetup);
router.post('/mfa/enable', require('../middlewares/auth'), auth.mfaEnable);
router.post('/mfa/disable', require('../middlewares/auth'), auth.mfaDisable);

module.exports = router;
