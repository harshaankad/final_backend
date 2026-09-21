const mongoose = require("mongoose");

// Who did what, to which record, from where. Append-only; nothing in the
// app updates or deletes these. Needed to answer "who has looked at this
// patient?" after an incident, and for the breach-notification duty under
// the DPDP Act.
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true }, // e.g. "patient.viewed"
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true },
    actorEmail: String, // kept even if the doctor row is later deleted
    actorRole: String,
    target: {
      type: { type: String }, // "patient" | "report" | "doctor"
      id: { type: mongoose.Schema.Types.ObjectId, index: true },
    },
    outcome: { type: String, enum: ["success", "failure"], default: "success" },
    ip: String,
    userAgent: String,
    meta: mongoose.Schema.Types.Mixed, // small, non-sensitive details only
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
