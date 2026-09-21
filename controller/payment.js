const Razorpay = require("razorpay");
const Patient = require("../models/patient");
const { safeEqual } = require("../utils/crypto");
const crypto = require("crypto");
const audit = require("../utils/audit");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID?.trim(),
    key_secret: process.env.RAZORPAY_KEY_SECRET?.trim()
});

// The price is decided here, never by the client.
const REPORT_FEE_INR = Number(process.env.REPORT_FEE_INR) || 299;
const REPORT_FEE_PAISE = REPORT_FEE_INR * 100;

// ✅ 1️⃣ Create Payment Order — for the caller's own unpaid patient only.
exports.createPayment = async (req, res) => {
    try {
        const { patientId } = req.body;

        const patient = await Patient.findOne({ _id: patientId, doctor: req.doctorId });
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }
        if (patient.paymentStatus === "completed") {
            return res.status(400).json({ success: false, message: "Payment already completed for this patient." });
        }

        const order = await razorpay.orders.create({
            amount: REPORT_FEE_PAISE,
            currency: "INR",
            receipt: `receipt_${patient._id}`,
            payment_capture: 1,
        });

        // Remember which order belongs to this patient so verification can't
        // be pointed at a different patient.
        patient.razorpayOrderId = order.id;
        await patient.save();

        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            patientId: patient._id
        });
    } catch (error) {
        console.error("createPayment error:", error.message);
        res.status(500).json({ success: false, message: "Error creating payment." });
    }
};

// ✅ 2️⃣ Verify Payment — called by the frontend after Razorpay checkout.
// Requires the doctor's session; the patient is resolved from the order id
// (not from the body), the signature is checked in constant time, and the
// payment is re-fetched from Razorpay so the amount and status are authoritative.
exports.verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const patient = await Patient.findOne({ razorpayOrderId: razorpay_order_id, doctor: req.doctorId });
        if (!patient) {
            return res.status(404).json({ success: false, message: "No pending order found for this payment." });
        }
        if (patient.paymentStatus === "completed") {
            // Idempotent: a retried callback is fine.
            return res.status(200).json({ success: true, message: "Payment already verified." });
        }

        const expected = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET.trim())
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");

        if (!safeEqual(expected, razorpay_signature)) {
            audit(req, "payment.verify_failed", { outcome: "failure", target: { type: "patient", id: patient._id }, meta: { reason: "signature" } });
            return res.status(400).json({ success: false, message: "Invalid payment signature." });
        }

        // Authoritative check with Razorpay: the payment must belong to this
        // order, be for the full fee, and be captured (or authorized with
        // auto-capture pending).
        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        if (!payment || payment.order_id !== razorpay_order_id) {
            return res.status(400).json({ success: false, message: "Payment does not match this order." });
        }
        if (payment.amount !== REPORT_FEE_PAISE || payment.currency !== "INR") {
            return res.status(400).json({ success: false, message: "Payment amount mismatch." });
        }
        if (!["captured", "authorized"].includes(payment.status)) {
            return res.status(400).json({ success: false, message: "Payment was not successful." });
        }

        patient.paymentStatus = "completed";
        patient.paymentId = razorpay_payment_id;
        patient.amountPaid = payment.amount / 100;
        patient.paymentDate = new Date();
        await patient.save();

        audit(req, "payment.verified", { target: { type: "patient", id: patient._id }, meta: { paymentId: razorpay_payment_id, amount: patient.amountPaid } });
        res.status(200).json({ success: true, message: "Payment verified and patient updated." });
    } catch (error) {
        console.error("verifyPayment error:", error.message);
        res.status(500).json({ success: false, message: "Payment verification failed." });
    }
};
