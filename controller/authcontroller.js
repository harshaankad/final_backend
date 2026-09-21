const OTP = require("../models/otp");
const { sendOtpEmail, sendAccountExistsEmail } = require("../utils/mailsender");
const Doctor = require("../models/doctor");
const bcrypt = require("bcryptjs");
const { randomNumericCode, safeEqual } = require("../utils/crypto");
const { signSessionToken, signMfaToken, publicDoctor } = require("../utils/tokens");
const { setSessionCookie, clearSessionCookie, setMfaCookie } = require("../utils/cookies");
const audit = require("../utils/audit");

// Request bodies are already validated and normalised by the zod schemas in
// validation/schemas.js (see routes/authroutes.js).

const BCRYPT_ROUNDS = 12;
const OTP_MAX_ATTEMPTS = 5;
const LOGIN_MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Pre-computed hash used to keep the "user not found" path as slow as a real
// bcrypt compare, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

const OTP_SENT_MESSAGE = "If this email is not already registered, a verification code has been sent.";

// ✅ Generate & Send OTP
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const userexists = await Doctor.findOne({ email });
    if (userexists) {
      // Same response as the success path so the endpoint can't be used to
      // enumerate doctor accounts; the owner gets told by email instead.
      sendAccountExistsEmail(email).catch((err) => console.error("account-exists mail failed:", err.message));
      audit(req, "signup.otp_requested", { actorEmail: email, outcome: "failure", meta: { reason: "exists" } });
      return res.status(200).json({ message: OTP_SENT_MESSAGE });
    }

    await OTP.deleteMany({ email });
    const otpCode = randomNumericCode(6);
    await OTP.create({ email, otp: otpCode });
    await sendOtpEmail(email, otpCode);
    audit(req, "signup.otp_requested", { actorEmail: email });

    res.status(200).json({ message: OTP_SENT_MESSAGE });
  } catch (error) {
    console.error("sendOtp error:", error.message);
    res.status(500).json({ error: "Error sending OTP." });
  }
};

// ✅ Verify OTP & Register Doctor
exports.verifyOtp = async (req, res) => {
  try {
    const { firstname, lastname, email, phone, password, age, qualificationPic, howDoYouKnowAdmin, otp } = req.body;

    const userexists = await Doctor.findOne({ email });
    if (userexists) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    // Look up by email only, then compare — never put the user-supplied code
    // in the query itself.
    const otpRecord = await OTP.findOne({ email });
    if (!otpRecord || otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      if (otpRecord) await OTP.deleteMany({ email });
      audit(req, "signup.otp_failed", { actorEmail: email, outcome: "failure" });
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }
    if (!safeEqual(otpRecord.otp, otp)) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      audit(req, "signup.otp_failed", { actorEmail: email, outcome: "failure" });
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Explicit field list: role and MFA state can never be set from the body.
    const newDoctor = await Doctor.create({
      firstname,
      lastname,
      email,
      phone,
      password: hashedPassword,
      age,
      qualificationPic: qualificationPic || "",
      howDoYouKnowAdmin,
    });

    await OTP.deleteMany({ email });
    audit(req, "doctor.signup", { actorEmail: email, target: { type: "doctor", id: newDoctor._id } });

    res.status(201).json({ message: "Signup successful!", doctorId: newDoctor._id });
  } catch (error) {
    console.error("verifyOtp error:", error.message);
    res.status(500).json({ error: "Error verifying OTP." });
  }
};

// ✅ Login. With MFA off the password alone yields a session cookie (and the
// client is asked to nudge the doctor to enable it). With MFA on, only a
// short-lived MFA cookie is set and /auth/mfa/verify issues the session.
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const doctor = await Doctor.findOne({ email }).select("+password +failedLoginAttempts +lockUntil");

    if (!doctor) {
      await bcrypt.compare(password, DUMMY_HASH); // keep timing consistent
      audit(req, "login.failed", { actorEmail: email, outcome: "failure", meta: { reason: "unknown_email" } });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (doctor.lockUntil && doctor.lockUntil > Date.now()) {
      const mins = Math.ceil((doctor.lockUntil - Date.now()) / 60000);
      audit(req, "login.locked", { actorEmail: email, outcome: "failure", target: { type: "doctor", id: doctor._id } });
      return res.status(423).json({ error: `Too many failed attempts. Account locked for ${mins} more minute${mins === 1 ? "" : "s"}.` });
    }

    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) {
      const attempts = (doctor.failedLoginAttempts || 0) + 1;
      const update = attempts >= LOGIN_MAX_ATTEMPTS
        ? { failedLoginAttempts: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { failedLoginAttempts: attempts };
      await Doctor.updateOne({ _id: doctor._id }, update);
      audit(req, "login.failed", { actorEmail: email, outcome: "failure", target: { type: "doctor", id: doctor._id }, meta: { attempts } });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (doctor.failedLoginAttempts || doctor.lockUntil) {
      await Doctor.updateOne({ _id: doctor._id }, { failedLoginAttempts: 0, $unset: { lockUntil: 1 } });
    }

    req.doctor = doctor; // for audit attribution

    if (!doctor.mfaEnabled) {
      setSessionCookie(res, signSessionToken(doctor));
      audit(req, "login.success", { meta: { mfa: false } });
      return res.status(200).json({
        success: true,
        doctor: publicDoctor(doctor),
        mfaPrompt: true, // client shows the "enable two-step verification" prompt
        message: "User Login Success",
      });
    }

    setMfaCookie(res, signMfaToken(doctor));
    audit(req, "login.password_ok", { meta: { mfa: true } });
    return res.status(200).json({
      success: true,
      mfaRequired: true,
      message: "Enter the code from your authenticator app.",
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Error logging in." });
  }
};

// Change password (authenticated). Revokes all other sessions and sets a
// fresh cookie so the current client stays signed in.
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const doctor = await Doctor.findById(req.doctorId).select("+password");
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    const isMatch = await bcrypt.compare(oldPassword, doctor.password);
    if (!isMatch) {
      audit(req, "password.change_failed", { outcome: "failure" });
      return res.status(400).json({ error: "Incorrect old password." });
    }

    doctor.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    doctor.tokenVersion = (doctor.tokenVersion || 0) + 1;
    await doctor.save();

    setSessionCookie(res, signSessionToken(doctor));
    audit(req, "password.changed");
    res.status(200).json({ message: "Password changed successfully!", doctor: publicDoctor(doctor) });
  } catch (error) {
    console.error("changePassword error:", error.message);
    res.status(500).json({ error: "Error changing password." });
  }
};

// Logout invalidates every session token for the account (all devices), not
// just the one on this device — stateless JWTs can't be revoked individually.
exports.logoutController = async (req, res) => {
  try {
    await Doctor.updateOne({ _id: req.doctorId }, { $inc: { tokenVersion: 1 } });
    clearSessionCookie(res);
    audit(req, "logout");
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};
