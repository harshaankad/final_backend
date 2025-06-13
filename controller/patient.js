const Patient = require("../models/patient");
const { uploadImageToCloudinary } = require("../utils/imageuploader");
const Report = require("../models/report");
const mongoose = require("mongoose");


exports.createPatient = async (req, res) => {
    try {
        console.log("Create Patient api hit");
        // Extract doctor ID from request
        const doctorId = req.doctorId;
        console.log("Doctor ID : ",doctorId);

        // Extract patient details from request body
        const { firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment } = req.body;

        console.log("Basic Details: " ,firstname, lastname, age, gender, duration, siteOfInfection, previousTreatment);

        console.log("Uploaded Files:", req.files);

        //Check if all required fields are provided
        if (!firstname || !lastname || !gender || !age || !duration || !siteOfInfection || !previousTreatment ||  !req.files || !req.files.nakedEyePhoto || !req.files.dermoscopePhoto) {
            return res.status(400).json({
                success: false,
                message: "All fields and images are required.",
            });
        }

        // Upload both images to Cloudinary
const nakedEyePhoto = await uploadImageToCloudinary(req.files.nakedEyePhoto, "patients");
const dermoscopePhoto = await uploadImageToCloudinary(req.files.dermoscopePhoto, "patients");

        // Create new patient entry
const newPatient = await Patient.create({
    doctor: doctorId, // Assign doctor ID correctly
    firstname,
    lastname,
    age,
    gender,
    duration,
    siteOfInfection,
    previousTreatment,
    nakedEyePhoto: nakedEyePhoto.secure_url, // Match schema field
    dermoscopePhoto: dermoscopePhoto.secure_url, // Match schema field
    status: "pending", // Default status
    paymentStatus: "pending", // Default payment status
    amountPaid: 0, // Default amount
});
        res.status(201).json({
            success: true,
            message: "Patient created successfully.",
            data: newPatient,
        });
    } catch (error) {
        console.error(error);
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

        const pendingPatients = await Patient.find({ doctor: doctorId, status: "pending" });

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

        const donePatients = await Patient.find({ doctor: doctorId, status: "done" });

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
    try {
        const doctorId = req.userId; // Extract doctor ID from token
        const { patientId } = req.params; // Get patient ID from URL params

        // ✅ Convert patientId to ObjectId
        const objectIdPatientId = new mongoose.Types.ObjectId(patientId);

        // ✅ Fetch patient details
        const patient = await Patient.findOne({ _id: objectIdPatientId, doctor: doctorId });

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





