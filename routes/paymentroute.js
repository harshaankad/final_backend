const express = require("express");
const { createPayment, verifyPayment } = require("../controller/payment");
const { auth, isDoctor } = require("../middlewares/authmiddleware");
const { validate } = require("../middlewares/validate");
const schemas = require("../validation/schemas");

const router = express.Router();

router.post("/create-payment", auth, isDoctor, validate(schemas.createPayment), createPayment);
// Called by the frontend after Razorpay checkout; the doctor's session is
// required so the order can be matched to their own patient.
router.post("/verify-payment", auth, isDoctor, validate(schemas.verifyPayment), verifyPayment);

module.exports = router;
