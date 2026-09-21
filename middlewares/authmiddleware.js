const Doctor = require("../models/doctor");
const { verifyToken } = require("../utils/tokens");
const { SESSION_COOKIE, MFA_COOKIE } = require("../utils/cookies");

// Session tokens normally arrive in the httpOnly `session` cookie. A Bearer
// header is still honoured (scripts, tests); the body is never read.
const extractToken = (req, cookieName) => {
  const cookie = req.cookies?.[cookieName];
  if (cookie) return { token: cookie, via: "cookie" };
  const header = req.header("Authorization");
  if (header && header.startsWith("Bearer ")) return { token: header.slice(7).trim(), via: "header" };
  return { token: null, via: null };
};

const unauthorized = (res, msg = "Invalid or expired token.") => res.status(401).json({ error: msg });

const DOCTOR_FIELDS = "role tokenVersion mfaEnabled email firstname lastname";

// Fully authenticated requests only. Loads the doctor from the DB so role
// changes, lockouts and logouts (tokenVersion) take effect immediately
// instead of when the JWT happens to expire.
exports.auth = async (req, res, next) => {
  try {
    const { token, via } = extractToken(req, SESSION_COOKIE);
    if (!token) return unauthorized(res, "Unauthorized. No token provided.");

    const decoded = verifyToken(token);
    if (decoded.stage !== "session") return unauthorized(res);

    const doctor = await Doctor.findById(decoded.doctorId).select(DOCTOR_FIELDS);
    if (!doctor) return unauthorized(res);
    if ((doctor.tokenVersion || 0) !== (decoded.tv || 0)) return unauthorized(res, "Session revoked. Please log in again.");

    req.doctor = doctor;
    req.doctorId = doctor._id;
    req.role = doctor.role;
    req.authVia = via;
    next();
  } catch (error) {
    return unauthorized(res);
  }
};

// Password verified, MFA code not yet. Used only by /auth/mfa/verify.
exports.mfaPendingAuth = async (req, res, next) => {
  try {
    const { token, via } = extractToken(req, MFA_COOKIE);
    if (!token) return unauthorized(res, "Unauthorized. No token provided.");

    const decoded = verifyToken(token);
    if (decoded.stage !== "mfa") return unauthorized(res);

    const doctor = await Doctor.findById(decoded.doctorId).select(DOCTOR_FIELDS);
    if (!doctor) return unauthorized(res);

    req.doctor = doctor;
    req.doctorId = doctor._id;
    req.role = doctor.role;
    req.authVia = via;
    next();
  } catch (error) {
    return unauthorized(res);
  }
};

exports.isDoctor = (req, res, next) => {
  if (req.doctor?.role !== "doctor") {
    return res.status(403).json({ error: "Access denied. Doctors only." });
  }
  next();
};

exports.isAdmin = (req, res, next) => {
  if (req.doctor?.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }
  next();
};
