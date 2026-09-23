const Doctor = require("../models/doctor");
const mailer = require("../utils/mailsender");
const logger = require("../utils/logger");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.ankad.in").replace(/\/$/, "");

const fullName = (doc) => [doc.firstname, doc.lastname].filter(Boolean).join(" ").trim();

// Email the submitting doctor that their patient's report is ready.
//
// Never throws. By the time this runs the report and the patient's status
// are already saved, so a mail problem must not turn a successful
// generation into an error response — the admin would retry and file the
// report twice. Resolves true if the email was handed to the SMTP server.
exports.notifyDoctorReportReady = async (patient, report) => {
  const ctx = { patientId: String(patient._id), reportId: String(report._id) };
  try {
    const doctor = await Doctor.findById(patient.doctor).select("firstname lastname email");
    if (!doctor || !doctor.email) {
      logger.warn(ctx, "report-ready email skipped: doctor not found");
      return false;
    }

    await mailer.sendReportReadyEmail({
      to: doctor.email,
      doctorName: fullName(doctor),
      patientName: fullName(patient),
      reportUrl: `${FRONTEND_URL}/report/${patient._id}`,
    });
    logger.info({ ...ctx, doctorId: String(doctor._id) }, "report-ready email sent");
    return true;
  } catch (err) {
    logger.error({ ...ctx, err: err.message }, "report-ready email failed");
    return false;
  }
};
