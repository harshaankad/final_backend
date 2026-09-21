const Patient = require("../models/patient");
const { uploadImageToCloudinary, ImageValidationError } = require("../utils/imageuploader");
const Report = require("../models/report");
const { presentPatient, presentReport, WITHOUT_PATIENT_IMAGES } = require("../utils/imageAccess");
const audit = require("../utils/audit");
const { deletePatientRecord } = require("../services/patientDeletion");

// Bump when the consent wording shown to doctors changes.
const CONSENT_VERSION = "2026-09";

const MAX_DERMOSCOPE_PHOTOS = 10;

exports.createPatient = async (req, res) => {
  try {
    const doctorId = req.doctorId;
    // Text fields already validated by validation/schemas.js#createPatient.
    const { firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment, clinicalImpression } = req.body;

    if (!req.files || !req.files.nakedEyePhoto || !req.files.dermoscopePhotos) {
      return res.status(400).json({
        success: false,
        message: "All fields and images are required.",
      });
    }

    let dermoscopeFiles = req.files.dermoscopePhotos;
    if (!Array.isArray(dermoscopeFiles)) {
      dermoscopeFiles = [dermoscopeFiles]; // wrap single into array
    }
    if (Array.isArray(req.files.nakedEyePhoto) || dermoscopeFiles.length > MAX_DERMOSCOPE_PHOTOS) {
      return res.status(400).json({ success: false, message: `Upload one clinical photo and up to ${MAX_DERMOSCOPE_PHOTOS} dermoscope photos.` });
    }

    // Each file is sniffed, re-encoded (EXIF stripped) and stored as an
    // authenticated asset; only the public_id is kept.
    const nakedEyeUpload = await uploadImageToCloudinary(req.files.nakedEyePhoto, "patients");
    const dermoscopeUploads = await Promise.all(
      dermoscopeFiles.map((file) => uploadImageToCloudinary(file, "patients"))
    );
    const dermoscopePhotoIds = dermoscopeUploads.map((img) => img.publicId);

    const newPatient = await Patient.create({
      doctor: doctorId,
      firstname,
      lastname,
      age,
      gender,
      duration,
      siteOfInfection,
      previousTreatment,
      clinicalImpression,
      nakedEyePhoto: nakedEyeUpload.publicId,
      dermoscopePhotos: dermoscopePhotoIds,
      consent: { given: true, at: new Date(), version: CONSENT_VERSION },
      status: "pending",
      paymentStatus: "pending",
      amountPaid: 0,
    });

    audit(req, "patient.created", { target: { type: "patient", id: newPatient._id }, meta: { images: 1 + dermoscopePhotoIds.length } });
    res.status(201).json({
      success: true,
      message: "Patient created successfully.",
      data: presentPatient(newPatient),
    });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error creating patient:", error.message);
    res.status(500).json({
      success: false,
      message: "Error creating patient.",
    });
  }
};

exports.getAllPatients = async (req, res) => {
    try {
        const patients = await Patient.find({ doctor: req.doctorId, paymentStatus: "completed" }).select(WITHOUT_PATIENT_IMAGES);

        res.status(200).json({
            success: true,
            message: "All patients fetched successfully.",
            data: patients
        });
    } catch (error) {
        console.error("getAllPatients error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error fetching patients.",
        });
    }
};


exports.getPendingPatients = async (req, res) => {
    try {
        const pendingPatients = await Patient.find({ doctor: req.doctorId, status: "pending", paymentStatus: "completed" }).select(WITHOUT_PATIENT_IMAGES);

        res.status(200).json({
            success: true,
            message: "Pending patients fetched successfully.",
            data: pendingPatients
        });
    } catch (error) {
        console.error("getPendingPatients error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error fetching pending patients.",
        });
    }
};


exports.getDonePatients = async (req, res) => {
    try {
        const donePatients = await Patient.find({ doctor: req.doctorId, status: "done", paymentStatus: "completed" }).select(WITHOUT_PATIENT_IMAGES);

        res.status(200).json({
            success: true,
            message: "Done patients fetched successfully.",
            data: donePatients
        });
    } catch (error) {
        console.error("getDonePatients error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error fetching done patients.",
        });
    }
};


// Used by both the doctor's report page and the admin's generate-report page.
// Doctors only ever see their own patients; admins see any.
exports.getPatientDetails = async (req, res) => {
    try {
        const { patientId } = req.params;

        const filter = { _id: patientId };
        if (req.role !== "admin") filter.doctor = req.doctorId;

        const patient = await Patient.findOne(filter);

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
        // Image refs become signed URLs valid for 30 minutes.
        return res.status(200).json({
            success: true,
            message: report ? "Patient details with report fetched successfully." : "Patient details fetched successfully.",
            data: { patient: presentPatient(patient), report: presentReport(report) },
        });

    } catch (error) {
        console.error("getPatientDetails error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error fetching patient details.",
        });
    }
};

// Erase a patient record (DB rows + every image). Doctors may only remove
// their own patients that never completed payment — an abandoned upload.
// Completed cases are medical records; only an admin can erase those (e.g.
// on a patient's request via the grievance officer).
exports.deletePatient = async (req, res) => {
    try {
        const { patientId } = req.params;
        const filter = { _id: patientId };
        if (req.role !== "admin") filter.doctor = req.doctorId;

        const patient = await Patient.findOne(filter);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }
        if (req.role !== "admin" && patient.paymentStatus === "completed") {
            audit(req, "patient.delete_denied", { outcome: "failure", target: { type: "patient", id: patient._id } });
            return res.status(403).json({
                success: false,
                message: "Completed cases are part of the medical record. Please contact the grievance officer to request erasure.",
            });
        }

        const result = await deletePatientRecord(patient);
        audit(req, "patient.deleted", { target: { type: "patient", id: patient._id }, meta: { ...result, paymentStatus: patient.paymentStatus } });

        res.status(200).json({ success: true, message: "Patient record and all images deleted." });
    } catch (error) {
        console.error("deletePatient error:", error.message);
        res.status(500).json({ success: false, message: "Error deleting patient." });
    }
};
