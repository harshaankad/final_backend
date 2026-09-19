const Doctor = require("../models/doctor");
const { verifyToken } = require("../utils/tokens");

// Token comes from the Authorization header or the cookie — never the body.
const extractToken = (req) => {
  const header = req.header("Authorization");
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.token || null;
};

const unauthorized = (res, msg = "Invalid or expired token.") => res.status(401).json({ error: msg });

// Fully authenticated requests only (password + MFA). Loads the doctor from
// the DB so role changes, lockouts and logouts (tokenVersion) take effect
// immediately instead of when the JWT happens to expire.
exports.auth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return unauthorized(res, "Unauthorized. No token provided.");

    const decoded = verifyToken(token);
    if (decoded.stage !== "session") return unauthorized(res);

    const doctor = await Doctor.findById(decoded.doctorId).select("role tokenVersion mfaEnabled email firstname lastname");
    if (!doctor) return unauthorized(res);
    if ((doctor.tokenVersion || 0) !== (decoded.tv || 0)) return unauthorized(res, "Session revoked. Please log in again.");

    req.doctor = doctor;
    req.doctorId = doctor._id;
    req.role = doctor.role;
    next();
  } catch (error) {
    return unauthorized(res);
  }
};

// Password verified, MFA not yet. Used only by the MFA endpoints.
// `stages` restricts which intermediate tokens a route accepts.
exports.mfaStageAuth = (stages) => async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return unauthorized(res, "Unauthorized. No token provided.");

    const decoded = verifyToken(token);
    if (!stages.includes(decoded.stage)) return unauthorized(res);

    const doctor = await Doctor.findById(decoded.doctorId).select("role tokenVersion mfaEnabled email firstname lastname");
    if (!doctor) return unauthorized(res);
    // A session token must still match the current tokenVersion.
    if (decoded.stage === "session" && (doctor.tokenVersion || 0) !== (decoded.tv || 0)) return unauthorized(res);

    req.doctor = doctor;
    req.doctorId = doctor._id;
    req.role = doctor.role;
    req.tokenStage = decoded.stage;
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
