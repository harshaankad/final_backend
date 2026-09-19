const express = require("express");
const { createPayment, verifyPayment } = require("../controller/payment");
const { auth, isDoctor } = require("../middlewares/authmiddleware");

const router = express.Router();

router.post("/create-payment", auth, isDoctor, createPayment);
// Called by the frontend after Razorpay checkout; the doctor's session is
// required so the order can be matched to their own patient.
router.post("/verify-payment", auth, isDoctor, verifyPayment);

module.exports = router;
