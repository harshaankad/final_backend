const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },

  dermoscopeFindings: String,
  clinicalImpression: String,

  editedNakedEyePhoto: String, // single edited photo
  editedDermoscopePhotos: [String], // array of edited dermoscope photo URLs

  digitalSignature: String,

  reportStatus: { type: String, enum: ["pending", "completed"], default: "pending" },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update `updatedAt` automatically before saving
reportSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Report", reportSchema);