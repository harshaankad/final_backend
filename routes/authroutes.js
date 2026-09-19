const express = require("express");
const { sendOtp, verifyOtp, login, changePassword, logoutController } = require("../controller/authcontroller");
const { auth, mfaStageAuth } = require("../middlewares/authmiddleware");
const { resetPasswordToken, resetPassword } = require("../controller/resetpassword");
const mfa = require("../controller/mfa");
const { authLimiter, emailLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

// Signup
router.post("/send-otp", emailLimiter, sendOtp);
router.post("/verify-otp", authLimiter, verifyOtp);

// Login: password → MFA-stage token → /mfa/verify → session token
router.post("/login", authLimiter, login);
router.post("/mfa/verify", authLimiter, mfaStageAuth(["mfa"]), mfa.verifyLogin);

// MFA enrolment: first-time (mfa_setup token from login) or re-enrol (session token)
router.post("/mfa/setup", authLimiter, mfaStageAuth(["mfa_setup", "session"]), mfa.setup);
router.post("/mfa/confirm", authLimiter, mfaStageAuth(["mfa_setup", "session"]), mfa.confirm);

// Account
router.post("/change-password", authLimiter, auth, changePassword);
router.post("/logout", auth, logoutController);

// Password reset
router.post("/resetpasswordtoken", emailLimiter, resetPasswordToken);
router.post("/resetpassword", authLimiter, resetPassword);

module.exports = router;
