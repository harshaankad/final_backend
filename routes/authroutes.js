const express = require("express");
const { sendOtp, verifyOtp, login, changePassword, logoutController } = require("../controller/authcontroller");
const { auth, mfaPendingAuth } = require("../middlewares/authmiddleware");
const { resetPasswordToken, resetPassword } = require("../controller/resetpassword");
const mfa = require("../controller/mfa");
const { authLimiter, emailLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

// Signup
router.post("/send-otp", emailLimiter, sendOtp);
router.post("/verify-otp", authLimiter, verifyOtp);

// Login: password → MFA-stage token → /mfa/verify → session token
router.post("/login", authLimiter, login);
router.post("/mfa/verify", authLimiter, mfaPendingAuth, mfa.verifyLogin);

// MFA enrolment (optional): a logged-in doctor turns it on, or re-enrols a new device
router.post("/mfa/setup", authLimiter, auth, mfa.setup);
router.post("/mfa/confirm", authLimiter, auth, mfa.confirm);

// Account
router.post("/change-password", authLimiter, auth, changePassword);
router.post("/logout", auth, logoutController);

// Password reset
router.post("/resetpasswordtoken", emailLimiter, resetPasswordToken);
router.post("/resetpassword", authLimiter, resetPassword);

module.exports = router;
