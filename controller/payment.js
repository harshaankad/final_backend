const Razorpay = require("razorpay");
const crypto = require("crypto");
const Patient = require("../models/patient");
const Doctor = require("../models/doctor");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ✅ 1️⃣ Create Payment Order
exports.createPayment = async (req, res) => {
    try {
        console.log("Create Payment route hit");
        const {patientId, amount } = req.body; // Amount in INR (Paise format: ₹10 = 1000)

        const patient = await Patient.findById(patientId);
        //const doctor =  await Doctor.findById(doctorId);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }
        // if (!doctor) {
        //     return res.status(404).json({ success: false, message: "Doctor not found." });
        // }

        const options = {
            amount: amount * 100, // Convert ₹ to Paise
            currency: "INR",
            receipt: `receipt_${patientId}`,
            payment_capture: 1, // Auto capture payment
        };

        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            patientId: patientId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error creating payment.", error: error.message });
    }
};



exports.verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, patientId } = req.body;

        const generated_signature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        console.log("Hashed Response : ",generated_signature);

        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: "Invalid payment signature." });
        }

        // ✅ Update Patient Payment Status
        await Patient.findByIdAndUpdate(patientId, {
            paymentStatus: "completed",
            amountPaid: 10,
            paymentId: razorpay_payment_id,
            amountPaid: req.body.amount,
            paymentDate: new Date()
        });

        res.status(200).json({ success: true, message: "Payment verified and patient updated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Payment verification failed.", error: error.message });
    }
};
