const express = require("express");
const { getAllCompletedPayments, getCompletedPaymentsDoneStatus, getCompletedPaymentsPendingStatus, getPatientDetailsAdmin, generateReport, getAllReports, getReportById, getMe, getAuditLog, deleteDoctor } = require("../controller/admin");
const { auth, isAdmin } = require("../middlewares/authmiddleware");
const { getAnalytics } = require("../controller/analytics");
const { uploadLimiter } = require("../middlewares/rateLimiters");
const { validate, validateParam } = require("../middlewares/validate");
const schemas = require("../validation/schemas");

const router = express.Router();

router.get("/admin-all", auth, isAdmin, getAllCompletedPayments);
router.get("/admin-done", auth, isAdmin, getCompletedPaymentsDoneStatus);
router.get("/admin-pending", auth, isAdmin, getCompletedPaymentsPendingStatus);
router.get("/admin-patient-details/:patientId", auth, isAdmin, validateParam("patientId"), getPatientDetailsAdmin);
router.post("/admin-generate-report/:patientId", auth, isAdmin, uploadLimiter, validateParam("patientId"), validate(schemas.generateReport), generateReport);
router.get("/admin-all-reports", auth, isAdmin, getAllReports);
router.get("/admin-report/:reportId", auth, isAdmin, validateParam("reportId"), getReportById);
router.get("/admin-analytics", auth, isAdmin, validate(schemas.analyticsQuery, "query"), getAnalytics);
router.get("/admin-audit", auth, isAdmin, validate(schemas.auditQuery, "query"), getAuditLog);
router.delete("/admin-doctor/:doctorId", auth, isAdmin, validateParam("doctorId"), deleteDoctor);
router.get("/me", auth, getMe);

module.exports = router;
