const Patient = require("../models/patient");
const mongoose = require("mongoose");
const Report = require("../models/report");
const Doctor = require("../models/doctor"); // ✅ Make sure this is your User model
const jwt = require("jsonwebtoken");
const { uploadImageToCloudinary } = require("../utils/imageuploader");
const editImage = require("../utils/editimage");
const fs = require("fs");

// ✅ Get all patients with paymentStatus: "completed"
exports.getAllCompletedPayments = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed" });

        res.status(200).json({
            success: true,
            message: "Patients with completed payments fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments.",
            error: error.message
        });
    }
};

// ✅ Get patients with paymentStatus: "completed" and status: "pending"
exports.getCompletedPaymentsPendingStatus = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed", status: "pending" });

        res.status(200).json({
            success: true,
            message: "Patients with completed payments and pending status fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments and pending status.",
            error: error.message
        });
    }
};

// ✅ Get patients with paymentStatus: "completed" and status: "done"
exports.getCompletedPaymentsDoneStatus = async (req, res) => {
    try {
        const patients = await Patient.find({ paymentStatus: "completed", status: "done" });

        res.status(200).json({
            success: true,
            message: "Patients with completed payments and done status fetched successfully.",
            data: patients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching patients with completed payments and done status.",
            error: error.message
        });
    }
};


// ✅ Admin - Get Patient Details by patientId
exports.getPatientDetailsAdmin = async (req, res) => {
    try {
        const { patientId } = req.params;

        if (!patientId) {
            return res.status(404).json({
                success: false,
                message: "PatientId not passed as parameter.",
            });
        }

        const objectIdPatientId = new mongoose.Types.ObjectId(patientId);

        const patient = await Patient.findOne({ _id: objectIdPatientId });

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found.",
            });
        }

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

exports.generateReport = async (req, res) => {
    try {
        const { patientId } = req.params;
        const { dermoscopeFindings, clinicalImpression, digitalSignature } = req.body;
        const { editedNakedEyePhoto, editedDermoscopePhoto } = req.files;

        console.log("Received Files:", req.files);

        if (!patientId || !dermoscopeFindings || !clinicalImpression || !digitalSignature) {
            return res.status(400).json({ success: false, message: "Please fill all details to generate the report" });
        }

        if (!req.files || !req.files.editedNakedEyePhoto || !req.files.editedDermoscopePhoto) {
            return res.status(400).json({ success: false, message: "Missing required image files." });
        }

        const objectIdPatientId = new mongoose.Types.ObjectId(patientId);

        const patient = await Patient.findById(objectIdPatientId);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }

        if (patient.paymentStatus !== "completed") {
            return res.status(400).json({ success: false, message: "Payment not completed." });
        }

        const uploadedNakedEye = await uploadImageToCloudinary(editedNakedEyePhoto, "reports");
        const uploadedDermoscope = await uploadImageToCloudinary(editedDermoscopePhoto, "reports");

        const newReport = new Report({
            doctor: patient.doctor,
            patient: objectIdPatientId,
            dermoscopeFindings,
            clinicalImpression,
            editedNakedEyePhoto: uploadedNakedEye.secure_url,
            editedDermoscopePhoto: uploadedDermoscope.secure_url,
            digitalSignature,
            reportStatus: "completed"
        });

        await newReport.save();

        patient.status = "done";
        await patient.save();

        return res.status(201).json({
            success: true,
            message: "Report generated successfully.",
            data: newReport,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error generating report.",
            error: error.message,
        });
    }
};

exports.getAllReports = async (req, res) => {
    try {
        const reports = await Report.find().populate("patient doctor", "firstname lastname age gender");

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
            error: error.message,
        });
    }
};

exports.getReportById = async (req, res) => {
    try {
        const { reportId } = req.params;

        if (!reportId) {
            return res.status(404).json({
                success: false,
                message: "ReportId not found.",
            });
        }

        const report = await Report.findById(reportId).populate("patient doctor", "firstname lastname age gender");

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Report not found.",
            });
        }

        res.status(200).json({
            success: true,
            message: "Report fetched successfully.",
            data: report,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching report.",
            error: error.message,
        });
    }
};



exports.getMe = async (req, res) => {
    try {
      console.log("✅ getMe API hit");
  
      if (!req.doctorId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: Doctor ID not found in token",
        });
      }
  
      const user = await Doctor.findById(req.doctorId).select("-password");
  
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
      console.error("❌ Error in getMe:", error);
      return res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  };