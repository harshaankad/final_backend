const AuditLog = require("../models/auditLog");
const logger = require("./logger");

/**
 * Record a security-relevant event. Fire-and-forget: a failure to write the
 * audit row is logged but never fails the request.
 *
 *   audit(req, "patient.viewed", { target: { type: "patient", id } })
 *   audit(req, "login.failed", { actorEmail, outcome: "failure" })
 */
module.exports = (req, action, { target, meta, outcome = "success", actorEmail } = {}) => {
  const row = {
    action,
    actor: req.doctor?._id || req.doctorId,
    actorEmail: actorEmail || req.doctor?.email,
    actorRole: req.doctor?.role,
    target,
    outcome,
    ip: req.ip,
    userAgent: (req.get("user-agent") || "").slice(0, 300),
    meta,
  };
  return AuditLog.create(row).catch((err) => logger.error({ err: err.message, action }, "audit write failed"));
};

// Same, for background jobs where there is no request or human actor.
// Returns the write promise so a job can await it before reporting done.
module.exports.system = (action, { target, meta, outcome = "success" } = {}) =>
  AuditLog.create({ action, actorEmail: "system", actorRole: "system", target, meta, outcome })
    .catch((err) => logger.error({ err: err.message, action }, "audit write failed"));
