const bcrypt = require("bcryptjs");
const Doctor = require("../models/doctor");
const { sendResetEmail } = require("../utils/mailsender");
const { randomToken, sha256 } = require("../utils/crypto");
const audit = require("../utils/audit");

const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.ankad.in").replace(/\/$/, "");

const GENERIC_MESSAGE = "If an account exists for that email, a password reset link has been sent.";

// Request a reset link. Only a hash of the token is stored; the response is
// identical whether or not the email is registered.
exports.resetPasswordToken = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Doctor.findOne({ email });
    audit(req, "password.reset_requested", { actorEmail: email, outcome: user ? "success" : "failure" });
    if (user) {
      const token = randomToken(32);
      await Doctor.updateOne(
        { _id: user._id },
        { resetPasswordTokenHash: sha256(token), resetPasswordExpires: new Date(Date.now() + RESET_TTL_MS) }
      );
      await sendResetEmail(email, `${FRONTEND_URL}/reset-password/${token}`);
    }

    res.status(200).json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("resetPasswordToken error:", error.message);
    res.status(500).json({ success: false, error: "Could not send the reset email." });
  }
};

// Consume the link: token must be a 64-char hex string, unexpired, and is
// cleared on use. All existing sessions are revoked.
exports.resetPassword = async (req, res) => {
  try {
    const { password, token } = req.body;

    const user = await Doctor.findOne({
      resetPasswordTokenHash: sha256(token),
      resetPasswordExpires: { $gt: new Date() },
    }).select("+resetPasswordTokenHash +resetPasswordExpires");

    if (!user) {
      audit(req, "password.reset_failed", { outcome: "failure" });
      return res.status(400).json({ success: false, error: "Reset link is invalid or has expired." });
    }

    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpires = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    audit(req, "password.reset", { actorEmail: user.email, target: { type: "doctor", id: user._id } });

    res.status(200).json({ success: true, message: "Password reset successful. Please log in." });
  } catch (error) {
    console.error("resetPassword error:", error.message);
    res.status(500).json({ success: false, error: "Could not reset the password." });
  }
};
