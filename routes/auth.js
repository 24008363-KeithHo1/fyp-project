const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');

router.post('/register', auth.register);
router.post('/login', auth.login);
router.get('/me', require('../middlewares/auth'), auth.me);
router.post('/invite', require('../middlewares/auth'), auth.invite);
router.get('/verify-invite', auth.verifyInvite);
router.post('/request-reset', auth.requestPasswordReset);
router.post('/reset', auth.resetPassword);
router.post('/mfa/verify', auth.mfaVerify);
router.post('/mfa/setup', require('../middlewares/auth'), auth.mfaSetup);
router.post('/mfa/enable', require('../middlewares/auth'), auth.mfaEnable);

module.exports = router;
