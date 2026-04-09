const Patient = require("../models/patient");
const { uploadImageToCloudinary } = require("../utils/imageuploader");
const Report = require("../models/report");
const mongoose = require("mongoose");


exports.createPatient = async (req, res) => {
  try {
    console.log("Create Patient API hit");

    // Extract doctor ID (set from auth middleware)
    const doctorId = req.doctorId;
    console.log("Doctor ID:", doctorId);

    // Extract patient details
    const { firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment, clinicalImpression } = req.body;
    console.log("Basic Details:", firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment, clinicalImpression);

    console.log("Uploaded Files:", req.files);

    // Validate required fields
    if (
      !firstname ||
      !lastname ||
      !gender ||
      !age ||
      !duration ||
      !siteOfInfection ||
      !previousTreatment ||
      !req.files ||
      !req.files.nakedEyePhoto ||
      !req.files.dermoscopePhotos
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields and images are required.",
      });
    }

    // ✅ Upload naked eye photo (single file)
    const nakedEyeUpload = await uploadImageToCloudinary(req.files.nakedEyePhoto, "patients");

    // ✅ Handle dermoscope photos (could be single file or multiple)
    let dermoscopeFiles = req.files.dermoscopePhotos;
    if (!Array.isArray(dermoscopeFiles)) {
      dermoscopeFiles = [dermoscopeFiles]; // wrap single into array
    }

    // Upload all dermoscope photos
    const dermoscopeUploads = await Promise.all(
      dermoscopeFiles.map((file) => uploadImageToCloudinary(file, "patients"))
    );

    // Extract URLs
    const dermoscopePhotoUrls = dermoscopeUploads.map((img) => img.secure_url);

    // ✅ Create new patient
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
      nakedEyePhoto: nakedEyeUpload.secure_url,
      dermoscopePhotos: dermoscopePhotoUrls, // now array
      status: "pending",
      paymentStatus: "pending",
      amountPaid: 0,
    });

    res.status(201).json({
      success: true,
      message: "Patient created successfully.",
      data: newPatient,
    });
  } catch (error) {
    console.error("Error creating patient:", error);
    res.status(500).json({
      success: false,
      message: "Error creating patient.",
      error: error.message,
    });
  }
};

exports.getAllPatients = async (req, res) => {
    try {
        const doctorId = req.doctorId; // Extract doctor ID from token
        console.log("Doctor ID : ",doctorId)

        console.log("All patients api hit")

        const patients = await Patient.find({ doctor: doctorId , paymentStatus: "completed" });

        res.status(200).json({
            success: true,
            message: "All patients fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients.",
            error: error.message
        });
    }
};


exports.getPendingPatients = async (req, res) => {
    try {
        const doctorId = req.doctorId; // Extract doctor ID from token

        const pendingPatients = await Patient.find({ doctor: doctorId, status: "pending", paymentStatus: "completed" });

        res.status(200).json({
            success: true,
            message: "Pending patients fetched successfully.",
            data: pendingPatients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pending patients.",
            error: error.message
        });
    }
};

exports.getDonePatients = async (req, res) => {
    try {
        const doctorId = req.doctorId; // Extract doctor ID from token

        const donePatients = await Patient.find({ doctor: doctorId, status: "done", paymentStatus: "completed" });

        res.status(200).json({
            success: true,
            message: "Done patients fetched successfully.",
            data: donePatients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching done patients.",
            error: error.message
        });
    }
};



exports.getPatientDetails = async (req, res) => {

console.log("Report api called");

    try {
        const doctorId = req.doctorId; // Extract doctor ID from token
        const { patientId } = req.params; // Get patient ID from URL params
        console.log("Patient id : ", patientId);
        console.log("Doctor id : ", doctorId);

        // ✅ Convert patientId to ObjectId
        const objectIdPatientId = new mongoose.Types.ObjectId(patientId);

        // ✅ Fetch patient details
        const patient = await Patient.findOne({ _id: objectIdPatientId});

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found.",
            });
        }

        // ✅ If status is "done", fetch the corresponding report
        let report = null;
        if (patient.status === "done") {
            report = await Report.findOne({ patient: objectIdPatientId });
        }

        return res.status(200).json({
            success: true,
            message: report ? "Patient details with report fetched successfully." : "Patient details fetched successfully.",
            data: { patient, report },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patient details.",
            error: error.message,
        });
    }
};





