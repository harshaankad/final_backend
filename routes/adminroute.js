const express = require("express");
const { getAllCompletedPayments, getCompletedPaymentsDoneStatus, getCompletedPaymentsPendingStatus, getPatientDetailsAdmin, generateReport, getAllReports, getReportById ,getMe} = require("../controller/admin");
const { auth, isAdmin} = require("../middlewares/authmiddleware");
const { getAnalytics } = require("../controller/analytics");
const { uploadLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

router.get("/admin-all", auth, isAdmin, getAllCompletedPayments);
router.get("/admin-done", auth, isAdmin, getCompletedPaymentsDoneStatus);
router.get("/admin-pending", auth, isAdmin, getCompletedPaymentsPendingStatus);
router.get("/admin-patient-details/:patientId", auth, isAdmin, getPatientDetailsAdmin);
router.post("/admin-generate-report/:patientId", auth, isAdmin, uploadLimiter, generateReport);
router.get("/admin-all-reports", auth, isAdmin, getAllReports);
router.get("/admin-report/:reportId", auth, isAdmin, getReportById);
router.get("/admin-analytics", auth, isAdmin, getAnalytics);
router.get("/me", auth, getMe);

module.exports = router;
