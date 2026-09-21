const Patient = require("../models/patient");
const Report = require("../models/report");
const { deletePatientRecord, purgeOriginals } = require("../services/patientDeletion");
const audit = require("../utils/audit");
const logger = require("../utils/logger");

// Data minimisation. Two rules, both configurable via env:
//
//  1. Uploads that never reached payment are abandoned submissions — the
//     photos serve no purpose. Erased after UNPAID_RETENTION_DAYS.
//  2. Once a report exists, the annotated copies on the report are the
//     medical record; the raw originals are the most sensitive thing we
//     hold and nothing displays them any more. Removed
//     ORIGINAL_PHOTO_RETENTION_DAYS after the report was generated.
//
// Set RETENTION_ENABLED=false to turn both off.
const DAY_MS = 24 * 60 * 60 * 1000;
const UNPAID_DAYS = Number(process.env.UNPAID_RETENTION_DAYS) || 7;
const ORIGINAL_DAYS = Number(process.env.ORIGINAL_PHOTO_RETENTION_DAYS) || 90;
const BATCH = 50;

exports.runRetention = async () => {
  const summary = { unpaidDeleted: 0, originalsPurged: 0, failed: 0 };

  const unpaid = await Patient.find({
    paymentStatus: { $ne: "completed" },
    createdAt: { $lt: new Date(Date.now() - UNPAID_DAYS * DAY_MS) },
  }).limit(BATCH);
  for (const p of unpaid) {
    try {
      const r = await deletePatientRecord(p);
      summary.unpaidDeleted++;
      await audit.system("retention.unpaid_deleted", { target: { type: "patient", id: p._id }, meta: { ageDays: UNPAID_DAYS, ...r } });
    } catch (err) {
      summary.failed++;
      logger.error({ err: err.message, patientId: String(p._id) }, "retention: unpaid delete failed");
    }
  }

  const cutoff = new Date(Date.now() - ORIGINAL_DAYS * DAY_MS);
  const oldReports = await Report.find({ createdAt: { $lt: cutoff } }).select("patient").limit(BATCH * 4).lean();
  const candidates = await Patient.find({
    _id: { $in: oldReports.map((r) => r.patient) },
    status: "done",
    originalsPurgedAt: { $exists: false },
    $or: [{ nakedEyePhoto: { $exists: true, $ne: null } }, { "dermoscopePhotos.0": { $exists: true } }],
  }).limit(BATCH);
  for (const p of candidates) {
    try {
      const n = await purgeOriginals(p);
      summary.originalsPurged++;
      await audit.system("retention.originals_purged", { target: { type: "patient", id: p._id }, meta: { images: n, afterDays: ORIGINAL_DAYS } });
    } catch (err) {
      summary.failed++;
      logger.error({ err: err.message, patientId: String(p._id) }, "retention: originals purge failed");
    }
  }

  logger.info(summary, "retention run complete");
  return summary;
};
