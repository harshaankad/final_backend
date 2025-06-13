const express = require("express");
const { createPayment, verifyPayment } = require("../controller/payment");
const { auth, isDoctor } = require("../middlewares/authmiddleware");

const router = express.Router();

router.post("/create-payment", auth, isDoctor, createPayment);
router.post("/verify-payment", verifyPayment); // No auth needed, called by Razorpay webhook

module.exports = router;
