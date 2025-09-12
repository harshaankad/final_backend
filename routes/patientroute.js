const express = require("express");
const { createPatient, getAllPatients, getPendingPatients, getDonePatients ,getPatientDetails} = require("../controller/patient");
const { auth, isDoctor } = require("../middlewares/authmiddleware");

const router = express.Router();

// ✅ Route to Create a Patient (Protected: Doctor Only)
router.post("/create-patient", auth, isDoctor, createPatient);
router.get("/all-patients", auth, isDoctor, getAllPatients);
router.get("/pending-patients", auth, isDoctor, getPendingPatients);
router.get("/done-patients", auth, isDoctor, getDonePatients);
router.get("/patient-details/:patientId", auth, getPatientDetails);

module.exports = router;
