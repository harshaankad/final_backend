const jwt = require("jsonwebtoken");

// Token stages:
//   session — fully authenticated. The only stage the `auth` middleware
//             accepts. Issued straight after the password when the account
//             has MFA off, or after a valid code when it is on.
//   mfa     — password verified, awaiting TOTP/backup code.
const SESSION_TTL = "12h";
const MFA_TTL = "5m";

const sign = (payload, expiresIn) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

exports.signSessionToken = (doctor) =>
  sign({ doctorId: doctor._id, role: doctor.role, tv: doctor.tokenVersion || 0, stage: "session" }, SESSION_TTL);

exports.signMfaToken = (doctor) => sign({ doctorId: doctor._id, stage: "mfa" }, MFA_TTL);

exports.verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

// Only the fields the frontend actually needs. Never spread a Mongoose doc
// into a response — that is how reset tokens and MFA state leaked before.
exports.publicDoctor = (doctor) => ({
  _id: doctor._id,
  firstname: doctor.firstname,
  lastname: doctor.lastname,
  email: doctor.email,
  role: doctor.role,
  mfaEnabled: !!doctor.mfaEnabled,
});
