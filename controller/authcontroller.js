const OTP = require("../models/otp");
const { sendOtpEmail, sendAccountExistsEmail } = require("../utils/mailsender");
const Doctor = require("../models/doctor");
const bcrypt = require("bcryptjs");
const { randomNumericCode, safeEqual } = require("../utils/crypto");
const { signSessionToken, signMfaToken, signMfaSetupToken, publicDoctor } = require("../utils/tokens");
const { isStr, isEmail, normalizeEmail, isPassword, passwordRule } = require("../utils/validate");

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
    const { email: rawEmail } = req.body;
    if (!isEmail(rawEmail)) {
      return res.status(400).json({ error: "Please enter a valid email." });
    }
    const email = normalizeEmail(rawEmail);

    const userexists = await Doctor.findOne({ email });
    if (userexists) {
      // Same response as the success path so the endpoint can't be used to
      // enumerate doctor accounts; the owner gets told by email instead.
      sendAccountExistsEmail(email).catch((err) => console.error("account-exists mail failed:", err.message));
      return res.status(200).json({ message: OTP_SENT_MESSAGE });
    }

    await OTP.deleteMany({ email });
    const otpCode = randomNumericCode(6);
    await OTP.create({ email, otp: otpCode });
    await sendOtpEmail(email, otpCode);

    res.status(200).json({ message: OTP_SENT_MESSAGE });
  } catch (error) {
    console.error("sendOtp error:", error.message);
    res.status(500).json({ error: "Error sending OTP." });
  }
};

// ✅ Verify OTP & Register Doctor
exports.verifyOtp = async (req, res) => {
  try {
    const { firstname, lastname, email: rawEmail, phone, password, age, qualificationPic, howDoYouKnowAdmin, otp } = req.body;

    if (!isStr(firstname, 100) || !isStr(lastname, 100) || !isEmail(rawEmail) || !isStr(phone, 20) || !isStr(howDoYouKnowAdmin, 50)) {
      return res.status(400).json({ error: "Please enter all details" });
    }
    if (!isPassword(password)) {
      return res.status(400).json({ error: passwordRule });
    }
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 120) {
      return res.status(400).json({ error: "Please enter a valid age." });
    }
    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }
    if (qualificationPic !== undefined && qualificationPic !== "" && !isStr(qualificationPic, 500)) {
      return res.status(400).json({ error: "Invalid qualification picture." });
    }
    const email = normalizeEmail(rawEmail);

    const userexists = await Doctor.findOne({ email });
    if (userexists) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    // Look up by email only, then compare — never put the user-supplied code
    // in the query itself.
    const otpRecord = await OTP.findOne({ email });
    if (!otpRecord || otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      if (otpRecord) await OTP.deleteMany({ email });
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }
    if (!safeEqual(otpRecord.otp, otp)) {
      await OTP.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Explicit field list: role and MFA state can never be set from the body.
    const newDoctor = await Doctor.create({
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email,
      phone: phone.trim(),
      password: hashedPassword,
      age: ageNum,
      qualificationPic: qualificationPic || "",
      howDoYouKnowAdmin,
    });

    await OTP.deleteMany({ email });

    res.status(201).json({ message: "Signup successful!", doctorId: newDoctor._id });
  } catch (error) {
    console.error("verifyOtp error:", error.message);
    res.status(500).json({ error: "Error verifying OTP." });
  }
};

// ✅ Login — step 1 of 2. Verifies the password and hands back an MFA-stage
// token. A session token is only issued by /auth/mfa/verify (or /auth/mfa/confirm
// on first enrolment), so every session is password + authenticator.
exports.login = async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;

    if (!isEmail(rawEmail) || !isStr(password, 128)) {
      return res.status(400).json({ error: "Please fill all details" });
    }
    const email = normalizeEmail(rawEmail);

    const doctor = await Doctor.findOne({ email }).select("+password +failedLoginAttempts +lockUntil");

    if (!doctor) {
      await bcrypt.compare(password, DUMMY_HASH); // keep timing consistent
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (doctor.lockUntil && doctor.lockUntil > Date.now()) {
      const mins = Math.ceil((doctor.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ error: `Too many failed attempts. Account locked for ${mins} more minute${mins === 1 ? "" : "s"}.` });
    }

    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) {
      const attempts = (doctor.failedLoginAttempts || 0) + 1;
      const update = attempts >= LOGIN_MAX_ATTEMPTS
        ? { failedLoginAttempts: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { failedLoginAttempts: attempts };
      await Doctor.updateOne({ _id: doctor._id }, update);
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (doctor.failedLoginAttempts || doctor.lockUntil) {
      await Doctor.updateOne({ _id: doctor._id }, { failedLoginAttempts: 0, $unset: { lockUntil: 1 } });
    }

    if (!doctor.mfaEnabled) {
      return res.status(200).json({
        success: true,
        mfaSetupRequired: true,
        mfaToken: signMfaSetupToken(doctor),
        message: "Set up your authenticator app to finish signing in.",
      });
    }

    return res.status(200).json({
      success: true,
      mfaRequired: true,
      mfaToken: signMfaToken(doctor),
      message: "Enter the code from your authenticator app.",
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Error logging in." });
  }
};

// Change password (authenticated). Revokes all other sessions and returns a
// fresh token so the current client stays signed in.
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!isStr(oldPassword, 128) || !isPassword(newPassword)) {
      return res.status(400).json({ error: `Please enter both old and new password. ${passwordRule}` });
    }

    const doctor = await Doctor.findById(req.doctorId).select("+password");
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    const isMatch = await bcrypt.compare(oldPassword, doctor.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect old password." });
    }

    doctor.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    doctor.tokenVersion = (doctor.tokenVersion || 0) + 1;
    await doctor.save();

    res.status(200).json({ message: "Password changed successfully!", token: signSessionToken(doctor), doctor: publicDoctor(doctor) });
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
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};
