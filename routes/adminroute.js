const express = require("express");
const { getAllCompletedPayments, getCompletedPaymentsDoneStatus, getCompletedPaymentsPendingStatus, getPatientDetailsAdmin, generateReport, getAllReports, getReportById ,getMe} = require("../controller/admin");
const { auth, isAdmin} = require("../middlewares/authmiddleware");

const router = express.Router();

router.get("/admin-all", auth, isAdmin, getAllCompletedPayments);
router.get("/admin-done", auth, isAdmin, getCompletedPaymentsDoneStatus);
router.get("/admin-pending", auth, isAdmin, getCompletedPaymentsPendingStatus);
router.get("/admin-patient-details/:patientId", auth, isAdmin, getPatientDetailsAdmin);
router.post("/admin-generate-report/:patientId", auth, isAdmin, generateReport);
router.get("/admin-all-reports", auth, isAdmin, getAllReports);
router.get("/admin-report/:reportId", auth, isAdmin, getReportById);
router.get("/me", auth, getMe);

module.exports = router;
