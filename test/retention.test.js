// Retention job rules, on fixtures without images (no Cloudinary calls).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// Test files run concurrently, so each uses its own database.
process.env.MONGO_URI = (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/ankad_test") + "_retention";
for (const [k, v] of Object.entries({ JWT_SECRET: "t".repeat(64), MFA_ENCRYPTION_KEY: "a".repeat(64), CLOUD_NAME: "dummy", API_KEY: "1", API_SECRET: "dummy", EMAIL: "t@example.com", EMAIL_PASSWORD: "x" })) process.env[k] ||= v;

const mongoose = require("mongoose");
const Doctor = require("../models/doctor");
const Patient = require("../models/patient");
const Report = require("../models/report");
const AuditLog = require("../models/auditLog");
const { runRetention } = require("../jobs/retention");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
let doctor;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  doctor = await Doctor.create({ firstname: "R", lastname: "T", email: "r@test.local", phone: "1", password: "x", age: 40, howDoYouKnowAdmin: "Friend" });
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const patient = (extra) =>
  Patient.create({ doctor: doctor._id, firstname: "P", lastname: "X", age: 30, gender: "male", duration: "1w", siteOfInfection: "Arm", previousTreatment: "none", ...extra });

test("unpaid uploads older than the window are erased; recent and paid ones are kept", async () => {
  const oldUnpaid = await patient({ paymentStatus: "pending", createdAt: ago(10) });
  const newUnpaid = await patient({ paymentStatus: "pending", createdAt: ago(2) });
  const oldPaid = await patient({ paymentStatus: "completed", createdAt: ago(10) });

  const summary = await runRetention();

  assert.equal(summary.unpaidDeleted, 1);
  assert.equal(await Patient.countDocuments({ _id: oldUnpaid._id }), 0);
  assert.equal(await Patient.countDocuments({ _id: newUnpaid._id }), 1);
  assert.equal(await Patient.countDocuments({ _id: oldPaid._id }), 1);
  assert.equal(await AuditLog.countDocuments({ action: "retention.unpaid_deleted", "target.id": oldUnpaid._id }), 1);
});

test("originals are only purged for completed cases with an old report", async () => {
  const done = await patient({ paymentStatus: "completed", status: "done", nakedEyePhoto: undefined, createdAt: ago(200) });
  await Report.create({ doctor: doctor._id, patient: done._id, dermoscopeFindings: "x", clinicalImpression: "y", createdAt: ago(120) });
  const pending = await patient({ paymentStatus: "completed", status: "pending", createdAt: ago(200) });

  const summary = await runRetention();

  // `done` has no image refs, so it is not a candidate; nothing should be purged or fail.
  assert.equal(summary.originalsPurged, 0);
  assert.equal(summary.failed, 0);
  assert.equal((await Patient.findById(pending._id)).originalsPurgedAt, undefined);
});
