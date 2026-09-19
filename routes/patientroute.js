const express = require("express");
const { createPatient, getAllPatients, getPendingPatients, getDonePatients, getPatientDetails } = require("../controller/patient");
const { auth, isDoctor } = require("../middlewares/authmiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

router.post("/create-patient", auth, isDoctor, uploadLimiter, createPatient);
router.get("/all-patients", auth, isDoctor, getAllPatients);
router.get("/pending-patients", auth, isDoctor, getPendingPatients);
router.get("/done-patients", auth, isDoctor, getDonePatients);
// Doctor (own patients) or admin (any) — scoping is enforced in the controller.
router.get("/patient-details/:patientId", auth, getPatientDetails);

module.exports = router;
