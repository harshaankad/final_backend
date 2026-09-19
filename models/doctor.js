const mongoose = require("mongoose");

// Fields marked `select: false` are never returned unless a query opts in with
// `.select("+field")`. That keeps hashes, MFA seeds and reset tokens out of
// every response by default.
const doctorSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  phone: String,
  password: { type: String, select: false },
  age: Number,
  qualificationPic: String,
  role: { type: String, enum: ["doctor", "admin"], default: "doctor" },

  // Password reset — only a hash of the emailed token is stored.
  resetPasswordTokenHash: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },

  // MFA (TOTP via authenticator app). Secrets are AES-256-GCM encrypted at rest.
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  mfaPendingSecret: { type: String, select: false }, // during enrolment, before first valid code
  mfaBackupCodes: { type: [String], select: false }, // sha256 hashes; each removed on use
  mfaLastUsedStep: { type: Number, select: false }, // replay protection for TOTP
  mfaFailedAttempts: { type: Number, default: 0, select: false },

  // Bumping this invalidates every previously issued session token.
  tokenVersion: { type: Number, default: 0 },

  // Brute-force lockout, independent of IP.
  failedLoginAttempts: { type: Number, default: 0, select: false },
  lockUntil: { type: Date, select: false },

  howDoYouKnowAdmin: {
    type: String,
    enum: ["Family", "Friend", "Colleague", "No Direct Connection"],
    required: true,
  },

  pendingPatients: [{ type: mongoose.Schema.Types.ObjectId, ref: "Patient" }],
  donePatients: [{ type: mongoose.Schema.Types.ObjectId, ref: "Patient" }],
});

module.exports = mongoose.model("Doctor", doctorSchema);
