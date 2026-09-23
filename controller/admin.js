const Patient = require("../models/patient");
const Report = require("../models/report");
const Doctor = require("../models/doctor");
const { uploadImageToCloudinary, ImageValidationError } = require("../utils/imageuploader");
const { presentPatient, presentReport, WITHOUT_PATIENT_IMAGES, WITHOUT_REPORT_IMAGES } = require("../utils/imageAccess");
const AuditLog = require("../models/auditLog");
const audit = require("../utils/audit");
const { deleteDoctorRecord } = require("../services/patientDeletion");
const { notifyDoctorReportReady } = require("../services/reportNotifications");

const MAX_DERMOSCOPE_PHOTOS = 10;

// ✅ Get all patients with paymentStatus: "completed" - POPULATED WITH DOCTOR INFO
exports.getAllCompletedPayments = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed" })
            .select(WITHOUT_PATIENT_IMAGES)
            .populate('doctor', 'firstname lastname email') // ✅ ADDED: Populate doctor details
            .sort({ createdAt: -1 }); // ✅ ADDED: Sort by most recent first

        res.status(200).json({
            success: true,
            message: "Patients with completed payments fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments."
        });
    }
};

// ✅ Get patients with paymentStatus: "completed" and status: "pending" - POPULATED WITH DOCTOR INFO
exports.getCompletedPaymentsPendingStatus = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed", status: "pending" })
            .select(WITHOUT_PATIENT_IMAGES)
            .populate('doctor', 'firstname lastname email') // ✅ ADDED: Populate doctor details
            .sort({ createdAt: -1 }); // ✅ ADDED: Sort by most recent first

        res.status(200).json({
            success: true,
            message: "Patients with completed payments and pending status fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments and pending status."
        });
    }
};

// ✅ Get patients with paymentStatus: "completed" and status: "done" - POPULATED WITH DOCTOR INFO
exports.getCompletedPaymentsDoneStatus = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed", status: "done" })
            .select(WITHOUT_PATIENT_IMAGES)
            .populate('doctor', 'firstname lastname email') // ✅ ADDED: Populate doctor details
            .sort({ createdAt: -1 }); // ✅ ADDED: Sort by most recent first

        res.status(200).json({
            success: true,
            message: "Patients with completed payments and done status fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments and done status."
        });
    }
};


// ✅ Admin - Get Patient Details by patientId - POPULATED WITH DOCTOR INFO
exports.getPatientDetailsAdmin = async (req, res) => {
    try {
        const { patientId } = req.params;

        const patient = await Patient.findOne({ _id: patientId })
            .populate('doctor', 'firstname lastname email'); // ✅ ADDED: Populate doctor details

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found.",
            });
        }

        let report = null;
        if (patient.status === "done") {
            report = await Report.findOne({ patient: patient._id });
        }

        audit(req, "patient.viewed", { target: { type: "patient", id: patient._id }, meta: { withReport: !!report } });
        return res.status(200).json({
            success: true,
            message: report ? "Patient details with report fetched successfully." : "Patient details fetched successfully.",
            data: { patient: presentPatient(patient), report: presentReport(report) },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patient details.",
        });
    }
};

exports.generateReport = async (req, res) => {

    try {
        const { patientId } = req.params;
        // Text fields already validated by validation/schemas.js#generateReport.
        const { dermoscopeFindings, clinicalImpression } = req.body;

        if (!req.files || !req.files.editedNakedEyePhoto || !req.files.editedDermoscopePhotos) {
            return res.status(400).json({ success: false, message: "Missing required image files." });
        }

        const { editedNakedEyePhoto, editedDermoscopePhotos } = req.files;

        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }

        if (patient.paymentStatus !== "completed") {
            return res.status(400).json({ success: false, message: "Payment not completed." });
        }

        // Upload naked eye photo (single)
        const uploadedNakedEye = await uploadImageToCloudinary(editedNakedEyePhoto, "reports");

        // Handle dermoscope photos (could be single file or multiple)
        let dermoscopeFiles = editedDermoscopePhotos;
        if (!Array.isArray(dermoscopeFiles)) {
            dermoscopeFiles = [dermoscopeFiles]; // wrap single into array
        }
        if (Array.isArray(editedNakedEyePhoto) || dermoscopeFiles.length > MAX_DERMOSCOPE_PHOTOS) {
            return res.status(400).json({ success: false, message: `Upload one clinical photo and up to ${MAX_DERMOSCOPE_PHOTOS} dermoscope photos.` });
        }

        // Upload all dermoscope photos
        const uploadedDermoscopePhotos = await Promise.all(
            dermoscopeFiles.map((file) => uploadImageToCloudinary(file, "reports"))
        );

        const newReport = new Report({
            doctor: patient.doctor,
            patient: patient._id,
            dermoscopeFindings,
            clinicalImpression,
            editedNakedEyePhoto: uploadedNakedEye.publicId,
            editedDermoscopePhotos: uploadedDermoscopePhotos.map((img) => img.publicId),
            reportStatus: "completed"
        });

        await newReport.save();

        patient.status = "done";
        await patient.save();

        // Filed under the patient so "everything that happened to this case" is one query.
        audit(req, "report.generated", { target: { type: "patient", id: patient._id }, meta: { reportId: newReport._id } });

        // Let the doctor know by email. Not awaited: the report is saved, so a
        // slow or failing mail server must neither delay nor fail this
        // response. notifyDoctorReportReady never rejects; the trailing catch
        // is insurance so nothing here can ever become an unhandled rejection.
        notifyDoctorReportReady(patient, newReport)
            .then((sent) => audit(req, "report.notified", { target: { type: "patient", id: patient._id }, meta: { reportId: newReport._id }, outcome: sent ? "success" : "failure" }))
            .catch((err) => console.error("report.notified audit failed:", err.message));

        return res.status(201).json({
            success: true,
            message: "Report generated successfully.",
            data: presentReport(newReport),
        });

    } catch (error) {
        if (error instanceof ImageValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Error generating report:", error.message);
        res.status(500).json({
            success: false,
            message: "Error generating report.",
        });
    }
};

exports.getAllReports = async (req, res) => {
    try {
        const reports = await Report.find().select(WITHOUT_REPORT_IMAGES).populate("patient doctor", "firstname lastname age gender");

        if (!reports || reports.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No reports found.",
            });
        }

        res.status(200).json({
            success: true,
            message: "Reports fetched successfully.",
            data: reports,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching reports.",
        });
    }
};

exports.getReportById = async (req, res) => {
    try {
        const { reportId } = req.params;

        const report = await Report.findById(reportId).populate("patient doctor", "firstname lastname age gender");

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        audit(req, "report.viewed", { target: { type: "report", id: report._id } });
        res.status(200).json({
            success: true,
            message: "Report fetched successfully.",
            data: presentReport(report),
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching report.",
        });
    }
};



exports.getMe = async (req, res) => {
    try {
      const user = await Doctor.findById(req.doctorId).select("firstname lastname email role mfaEnabled");
  
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
  
      return res.status(200).json({
        success: true,
        message: "User fetched successfully",
        user,
      });
    } catch (error) {
      console.error("getMe error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  };

// Admin: page through the audit trail, newest first. Cursor on createdAt.
exports.getAuditLog = async (req, res) => {
    try {
        const { limit, before, action, actor, targetId } = req.query;
        const filter = {};
        if (before) filter.createdAt = { $lt: new Date(before) };
        if (action) filter.action = action;
        if (actor) filter.actor = actor;
        if (targetId) filter["target.id"] = targetId;

        const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
        res.status(200).json({
            success: true,
            data: rows,
            nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt : null,
        });
    } catch (error) {
        console.error("getAuditLog error:", error.message);
        res.status(500).json({ success: false, message: "Error fetching audit log." });
    }
};

// Admin: erase a doctor account together with all of their patients,
// reports and images (right-to-erasure fulfilment). Admins cannot erase
// themselves or another admin from here.
exports.deleteDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (String(doctorId) === String(req.doctorId)) {
            return res.status(400).json({ success: false, message: "You cannot delete your own account from here." });
        }
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found." });
        }
        if (doctor.role === "admin") {
            return res.status(403).json({ success: false, message: "Admin accounts cannot be deleted through the API." });
        }

        const result = await deleteDoctorRecord(doctor);
        audit(req, "doctor.deleted", { target: { type: "doctor", id: doctor._id }, meta: { email: doctor.email, ...result } });

        res.status(200).json({ success: true, message: "Doctor account, patients, reports and images deleted.", ...result });
    } catch (error) {
        console.error("deleteDoctor error:", error.message);
        res.status(500).json({ success: false, message: "Error deleting doctor." });
    }
};
