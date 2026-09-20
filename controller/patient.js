const Patient = require("../models/patient");
const { uploadImageToCloudinary, ImageValidationError } = require("../utils/imageuploader");
const Report = require("../models/report");
const mongoose = require("mongoose");
const { isStr } = require("../utils/validate");
const { presentPatient, presentReport, WITHOUT_PATIENT_IMAGES } = require("../utils/imageAccess");

const MAX_DERMOSCOPE_PHOTOS = 10;

exports.createPatient = async (req, res) => {
  try {
    const doctorId = req.doctorId;
    const { firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment, clinicalImpression } = req.body;

    if (
      !isStr(firstname, 100) ||
      !isStr(lastname, 100) ||
      !isStr(gender, 10) ||
      !isStr(duration, 200) ||
      !isStr(siteOfInfection, 500) ||
      !isStr(previousTreatment, 2000) ||
      !req.files ||
      !req.files.nakedEyePhoto ||
      !req.files.dermoscopePhotos
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields and images are required.",
      });
    }
    if (clinicalImpression !== undefined && clinicalImpression !== "" && !isStr(clinicalImpression, 2000)) {
      return res.status(400).json({ success: false, message: "Clinical impression is too long." });
    }
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) {
      return res.status(400).json({ success: false, message: "Please enter a valid age." });
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
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      age: ageNum,
      gender,
      duration,
      siteOfInfection,
      previousTreatment,
      clinicalImpression,
      nakedEyePhoto: nakedEyeUpload.publicId,
      dermoscopePhotos: dermoscopePhotoIds,
      status: "pending",
      paymentStatus: "pending",
      amountPaid: 0,
    });

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
        if (!mongoose.isValidObjectId(patientId)) {
            return res.status(400).json({ success: false, message: "Invalid patient id." });
        }

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
