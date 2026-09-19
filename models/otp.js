const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  otp: { type: String, required: true },
  attempts: { type: Number, default: 0 }, // wrong guesses; record is deleted at MAX
  createdAt: { type: Date, default: Date.now, expires: 300 } // OTP expires in 5 mins
});

module.exports = mongoose.model("OTP", otpSchema);
