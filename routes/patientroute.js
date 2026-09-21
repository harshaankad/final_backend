const express = require("express");
const { createPatient, getAllPatients, getPendingPatients, getDonePatients, getPatientDetails, deletePatient } = require("../controller/patient");
const { auth, isDoctor } = require("../middlewares/authmiddleware");
const { uploadLimiter } = require("../middlewares/rateLimiters");
const { validate, validateParam } = require("../middlewares/validate");
const schemas = require("../validation/schemas");

const router = express.Router();

router.post("/create-patient", auth, isDoctor, uploadLimiter, validate(schemas.createPatient), createPatient);
router.get("/all-patients", auth, isDoctor, getAllPatients);
router.get("/pending-patients", auth, isDoctor, getPendingPatients);
router.get("/done-patients", auth, isDoctor, getDonePatients);
// Doctor (own patients) or admin (any) — scoping is enforced in the controller.
router.get("/patient-details/:patientId", auth, validateParam("patientId"), getPatientDetails);
// Doctor: own unpaid patient only. Admin: any patient.
router.delete("/patient/:patientId", auth, validateParam("patientId"), deletePatient);

module.exports = router;
