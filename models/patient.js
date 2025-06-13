const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },

  firstname: String,
  lastname: String,
  age: Number,
  gender: { type: String, enum: ["male", "female", "other"], required: true },
  duration: String,
  siteOfInfection: String,
  previousTreatment: String,

  nakedEyePhoto: String, 
  dermoscopePhoto: String,

  status: { type: String, enum: ["pending", "done"], default: "pending" },

  paymentStatus: { type: String, enum: ["pending", "completed"], default: "pending" },
  paymentId: String,
  amountPaid: Number,
  paymentDate: Date,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Patient", patientSchema);
