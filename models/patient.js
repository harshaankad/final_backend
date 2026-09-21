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
  clinicalImpression: String,

  nakedEyePhoto: String, // Cloudinary public_id (authenticated asset)
  dermoscopePhotos: [String],
  // Originals are removed by the retention job some time after the report
  // is done; the annotated copies on the report remain the record.
  originalsPurgedAt: Date,

  // Recorded by the submitting doctor on behalf of the patient (DPDP).
  consent: {
    given: { type: Boolean, default: false },
    at: Date,
    version: String, // which wording of the consent text was shown
  },

  status: { type: String, enum: ["pending", "done"], default: "pending" },

  paymentStatus: { type: String, enum: ["pending", "completed"], default: "pending" },
  paymentId: String,
  razorpayOrderId: { type: String, index: true }, // set at order creation; verify-payment resolves the patient by this
  amountPaid: Number,
  paymentDate: Date,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update `updatedAt` automatically before saving
patientSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Patient", patientSchema);
