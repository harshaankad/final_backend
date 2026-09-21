const express = require("express");
const { sendOtp, verifyOtp, login, changePassword, logoutController } = require("../controller/authcontroller");
const { auth, mfaPendingAuth } = require("../middlewares/authmiddleware");
const { resetPasswordToken, resetPassword } = require("../controller/resetpassword");
const mfa = require("../controller/mfa");
const { authLimiter, emailLimiter } = require("../middlewares/rateLimiters");
const { validate } = require("../middlewares/validate");
const schemas = require("../validation/schemas");

const router = express.Router();

// Signup
router.post("/send-otp", emailLimiter, validate(schemas.sendOtp), sendOtp);
router.post("/verify-otp", authLimiter, validate(schemas.verifyOtp), verifyOtp);

// Login: password → (MFA cookie → /mfa/verify) → session cookie
router.post("/login", authLimiter, validate(schemas.login), login);
router.post("/mfa/verify", authLimiter, mfaPendingAuth, validate(schemas.mfaLoginCode), mfa.verifyLogin);

// MFA enrolment (optional): a logged-in doctor turns it on, or re-enrols a new device
router.post("/mfa/setup", authLimiter, auth, mfa.setup);
router.post("/mfa/confirm", authLimiter, auth, validate(schemas.mfaCode), mfa.confirm);

// Account
router.post("/change-password", authLimiter, auth, validate(schemas.changePassword), changePassword);
router.post("/logout", auth, logoutController);

// Password reset
router.post("/resetpasswordtoken", emailLimiter, validate(schemas.resetPasswordToken), resetPasswordToken);
router.post("/resetpassword", authLimiter, validate(schemas.resetPassword), resetPassword);

module.exports = router;
