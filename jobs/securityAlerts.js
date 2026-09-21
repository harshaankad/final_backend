const AuditLog = require("../models/auditLog");
const { sendSecurityAlertEmail } = require("../utils/mailsender");
const logger = require("../utils/logger");

// Watches the audit log for signs of an attack and emails the admin.
// Thresholds are per 15-minute window; each alert type fires at most once
// an hour so a sustained attack doesn't flood the inbox.
const WINDOW_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60 * 60 * 1000;
const THRESHOLDS = {
  "login.failed": Number(process.env.ALERT_FAILED_LOGINS) || 20,
  "login.locked": Number(process.env.ALERT_LOCKOUTS) || 3,
  "mfa.verify_failed": Number(process.env.ALERT_MFA_FAILURES) || 10,
  "patient.delete_denied": 5,
};
const lastAlertAt = {};

exports.checkSecurityAlerts = async () => {
  const since = new Date(Date.now() - WINDOW_MS);
  const counts = await AuditLog.aggregate([
    { $match: { createdAt: { $gte: since }, action: { $in: Object.keys(THRESHOLDS) } } },
    { $group: { _id: "$action", count: { $sum: 1 }, ips: { $addToSet: "$ip" }, emails: { $addToSet: "$actorEmail" } } },
  ]);

  const triggered = counts.filter((c) => c.count >= THRESHOLDS[c._id] && (Date.now() - (lastAlertAt[c._id] || 0)) > COOLDOWN_MS);
  if (!triggered.length) return null;

  const lines = triggered.map((c) => `${c._id}: ${c.count} in the last 15 minutes (${c.ips.length} IP address${c.ips.length === 1 ? "" : "es"}, ${c.emails.filter(Boolean).length} account${c.emails.filter(Boolean).length === 1 ? "" : "s"})`);
  logger.warn({ triggered: lines }, "security alert");
  try {
    await sendSecurityAlertEmail(lines);
    for (const c of triggered) lastAlertAt[c._id] = Date.now();
  } catch (err) {
    logger.error({ err: err.message }, "security alert email failed");
  }
  return lines;
};
