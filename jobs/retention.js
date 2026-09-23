const Patient = require("../models/patient");
const Report = require("../models/report");
const { deletePatientRecord, purgeImages } = require("../services/patientDeletion");
const audit = require("../utils/audit");
const logger = require("../utils/logger");

// Data minimisation. Two rules, both configurable via env:
//
//  1. Uploads that never reached payment are abandoned submissions — the
//     photos serve no purpose. Erased after UNPAID_RETENTION_DAYS. The
//     default is 30 days: short enough to not hoard unpaid photographs,
//     long enough that a clinic which is slow to pay doesn't lose a real
//     patient's images.
//  2. Photographs are kept for a limited period only, as the report
//     disclaimer tells patients. IMAGE_RETENTION_DAYS after the report is
//     generated, every image for that case is deleted — the doctor's
//     originals and the annotated copies on the report alike. The written
//     report (findings, impression, patient details) is kept.
//
// Set RETENTION_ENABLED=false to turn both off.
const DAY_MS = 24 * 60 * 60 * 1000;
const UNPAID_DAYS = Number(process.env.UNPAID_RETENTION_DAYS) || 30;
const IMAGE_DAYS = Number(process.env.IMAGE_RETENTION_DAYS || process.env.ORIGINAL_PHOTO_RETENTION_DAYS) || 90;
const BATCH = 50;

exports.runRetention = async () => {
  const summary = { unpaidDeleted: 0, imagesPurged: 0, failed: 0 };

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

  const cutoff = new Date(Date.now() - IMAGE_DAYS * DAY_MS);
  const oldReports = await Report.find({ createdAt: { $lt: cutoff } }).select("patient").limit(BATCH * 4).lean();
  const candidates = await Patient.find({
    _id: { $in: oldReports.map((r) => r.patient) },
    status: "done",
    imagesPurgedAt: { $exists: false },
  }).limit(BATCH);
  for (const p of candidates) {
    try {
      const n = await purgeImages(p);
      summary.imagesPurged++;
      await audit.system("retention.images_purged", { target: { type: "patient", id: p._id }, meta: { images: n, afterDays: IMAGE_DAYS } });
    } catch (err) {
      summary.failed++;
      logger.error({ err: err.message, patientId: String(p._id) }, "retention: image purge failed");
    }
  }

  logger.info(summary, "retention run complete");
  return summary;
};
