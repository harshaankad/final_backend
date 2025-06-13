const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },

  dermoscopeFindings: String,
  clinicalImpression: String,

  editedNakedEyePhoto: String, 
  editedDermoscopePhoto: String,

  digitalSignature: String,

  reportStatus: { type: String, enum: ["pending", "completed"], default: "pending" },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Report", reportSchema);
