const QRCode = require("qrcode");
const { generateSecret, generateURI, verify } = require("otplib");
const Doctor = require("../models/doctor");
const { encrypt, decrypt, sha256, randomBackupCode } = require("../utils/crypto");
const { signSessionToken, publicDoctor } = require("../utils/tokens");
const { isTotpCode } = require("../utils/validate");
const { setSessionCookie, clearMfaCookie } = require("../utils/cookies");
const audit = require("../utils/audit");

const ISSUER = "DermaDrishti";
const BACKUP_CODE_COUNT = 8;
const MFA_MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const TOTP_PERIOD = 30;
// Accept the previous/next 30s step to absorb clock drift on the phone.
const EPOCH_TOLERANCE = 30;

const normalizeBackupCode = (code) => {
  const raw = code.trim().toUpperCase().replace(/-/g, "");
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
};

const currentStep = () => Math.floor(Date.now() / 1000 / TOTP_PERIOD);

// Start (or restart) enrolment for a logged-in doctor — first-time, or an
// already-enrolled doctor moving to a new device. The new secret is stored as
// *pending* and only becomes live once the doctor proves the app works by
// submitting a valid code to /confirm.
exports.setup = async (req, res) => {
  try {
    const secret = generateSecret();
    await Doctor.updateOne({ _id: req.doctorId }, { mfaPendingSecret: encrypt(secret) });

    const otpauthUrl = generateURI({ issuer: ISSUER, label: req.doctor.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });

    res.status(200).json({ success: true, qrDataUrl, manualKey: secret, issuer: ISSUER, account: req.doctor.email });
  } catch (error) {
    console.error("mfa setup error:", error.message);
    res.status(500).json({ success: false, error: "Could not start authenticator setup." });
  }
};

// Finish enrolment: verify one code against the pending secret, promote it,
// issue backup codes (shown once) and a full session token.
exports.confirm = async (req, res) => {
  try {
    const { code } = req.body;

    const doctor = await Doctor.findById(req.doctorId).select("+mfaPendingSecret");
    if (!doctor || !doctor.mfaPendingSecret) {
      return res.status(400).json({ success: false, error: "No authenticator setup in progress. Please start again." });
    }

    const secret = decrypt(doctor.mfaPendingSecret);
    const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE });
    if (!result.valid) {
      audit(req, "mfa.confirm_failed", { outcome: "failure" });
      return res.status(400).json({ success: false, error: "That code didn't match. Check the time on your phone and try again." });
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, randomBackupCode);

    doctor.mfaSecret = doctor.mfaPendingSecret;
    doctor.mfaPendingSecret = undefined;
    doctor.mfaEnabled = true;
    doctor.mfaLastUsedStep = result.timeStep;
    doctor.mfaBackupCodes = backupCodes.map(sha256);
    doctor.mfaFailedAttempts = 0;
    // Enabling/re-enrolling signs out every other device; the response
    // carries a fresh token for this one.
    doctor.tokenVersion = (doctor.tokenVersion || 0) + 1;
    await doctor.save();

    setSessionCookie(res, signSessionToken(doctor));
    audit(req, "mfa.enabled");
    res.status(200).json({
      success: true,
      doctor: publicDoctor(doctor),
      backupCodes,
      message: "Authenticator app enabled.",
    });
  } catch (error) {
    console.error("mfa confirm error:", error.message);
    res.status(500).json({ success: false, error: "Could not confirm authenticator setup." });
  }
};

// Login step 2: TOTP code or a one-time backup code → session token.
exports.verifyLogin = async (req, res) => {
  try {
    const { code } = req.body;

    const doctor = await Doctor.findById(req.doctorId).select(
      "+mfaSecret +mfaBackupCodes +mfaLastUsedStep +mfaFailedAttempts +lockUntil"
    );
    if (!doctor || !doctor.mfaEnabled || !doctor.mfaSecret) {
      return res.status(400).json({ success: false, error: "Authenticator is not set up for this account." });
    }
    if (doctor.lockUntil && doctor.lockUntil > Date.now()) {
      const mins = Math.ceil((doctor.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ success: false, error: `Too many failed attempts. Account locked for ${mins} more minute${mins === 1 ? "" : "s"}.` });
    }

    let valid = false;
    const update = {};

    if (isTotpCode(code)) {
      const secret = decrypt(doctor.mfaSecret);
      const opts = { secret, token: code, epochTolerance: EPOCH_TOLERANCE };
      // Reject any step already used (replay). Skip the bound if it would be
      // ahead of "now" (clock was corrected backwards) — otplib throws on that.
      if (Number.isInteger(doctor.mfaLastUsedStep) && doctor.mfaLastUsedStep <= currentStep()) {
        opts.afterTimeStep = doctor.mfaLastUsedStep;
      }
      const result = await verify(opts);
      if (result.valid) {
        valid = true;
        update.mfaLastUsedStep = result.timeStep;
      }
    } else {
      const hash = sha256(normalizeBackupCode(code));
      if ((doctor.mfaBackupCodes || []).includes(hash)) {
        valid = true;
        update.$pull = { mfaBackupCodes: hash };
      }
    }

    if (!valid) {
      const attempts = (doctor.mfaFailedAttempts || 0) + 1;
      const fail = attempts >= MFA_MAX_ATTEMPTS
        ? { mfaFailedAttempts: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { mfaFailedAttempts: attempts };
      await Doctor.updateOne({ _id: doctor._id }, fail);
      audit(req, "mfa.verify_failed", { outcome: "failure", meta: { attempts } });
      return res.status(401).json({ success: false, error: "Invalid code." });
    }

    update.mfaFailedAttempts = 0;
    await Doctor.updateOne({ _id: doctor._id }, update);

    const remainingBackupCodes = update.$pull ? (doctor.mfaBackupCodes.length - 1) : doctor.mfaBackupCodes.length;

    setSessionCookie(res, signSessionToken(doctor));
    clearMfaCookie(res);
    audit(req, "login.success", { meta: { mfa: true, backupCode: !!update.$pull, remainingBackupCodes } });
    res.status(200).json({
      success: true,
      doctor: publicDoctor(doctor),
      remainingBackupCodes,
      message: "User Login Success",
    });
  } catch (error) {
    console.error("mfa verify error:", error.message);
    res.status(500).json({ success: false, error: "Could not verify code." });
  }
};
