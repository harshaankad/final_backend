// Retention job rules. deleteImage is stubbed, so no Cloudinary calls are made.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// Test files run concurrently, so each uses its own database.
process.env.MONGO_URI = (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/ankad_test") + "_retention";
// Pin the windows so these tests describe the rules, not today's defaults.
process.env.UNPAID_RETENTION_DAYS = "7";
process.env.IMAGE_RETENTION_DAYS = "90";
for (const [k, v] of Object.entries({ JWT_SECRET: "t".repeat(64), MFA_ENCRYPTION_KEY: "a".repeat(64), CLOUD_NAME: "dummy", API_KEY: "1", API_SECRET: "dummy", EMAIL: "t@example.com", EMAIL_PASSWORD: "x" })) process.env[k] ||= v;

const mongoose = require("mongoose");
const Doctor = require("../models/doctor");
const Patient = require("../models/patient");
const Report = require("../models/report");
const AuditLog = require("../models/auditLog");
const imageuploader = require("../utils/imageuploader");
const { runRetention } = require("../jobs/retention");

// Record what would have been deleted instead of calling Cloudinary.
let deleted = [];
imageuploader.deleteImage = async (ref) => { deleted.push(ref); };

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
beforeEach(() => { deleted = []; });

const patient = (extra) =>
  Patient.create({ doctor: doctor._id, firstname: "P", lastname: "X", age: 30, gender: "male", duration: "1w", siteOfInfection: "Arm", previousTreatment: "none", ...extra });

test("unpaid uploads older than the window are erased; recent and paid ones are kept", async () => {
  const oldUnpaid = await patient({ paymentStatus: "pending", createdAt: ago(10), nakedEyePhoto: "patients/a", dermoscopePhotos: ["patients/b"] });
  const newUnpaid = await patient({ paymentStatus: "pending", createdAt: ago(2) });
  const oldPaid = await patient({ paymentStatus: "completed", createdAt: ago(10) });

  const summary = await runRetention();

  assert.equal(summary.unpaidDeleted, 1);
  assert.deepEqual(deleted.sort(), ["patients/a", "patients/b"]);
  assert.equal(await Patient.countDocuments({ _id: oldUnpaid._id }), 0);
  assert.equal(await Patient.countDocuments({ _id: newUnpaid._id }), 1);
  assert.equal(await Patient.countDocuments({ _id: oldPaid._id }), 1);
  assert.equal(await AuditLog.countDocuments({ action: "retention.unpaid_deleted", "target.id": oldUnpaid._id }), 1);
});

test("after the retention period ALL images go — originals and report copies — but the written report stays", async () => {
  const p = await patient({ paymentStatus: "completed", status: "done", createdAt: ago(200), nakedEyePhoto: "patients/orig1", dermoscopePhotos: ["patients/orig2", "patients/orig3"] });
  const r = await Report.create({
    doctor: doctor._id, patient: p._id, dermoscopeFindings: "findings text", clinicalImpression: "impression text",
    editedNakedEyePhoto: "reports/edit1", editedDermoscopePhotos: ["reports/edit2"], createdAt: ago(120),
  });

  const summary = await runRetention();
  assert.equal(summary.imagesPurged, 1);
  assert.equal(summary.failed, 0);

  // every image, both kinds, handed to Cloudinary for deletion
  assert.deepEqual(deleted.sort(), ["patients/orig1", "patients/orig2", "patients/orig3", "reports/edit1", "reports/edit2"]);

  const pAfter = await Patient.findById(p._id);
  assert.equal(pAfter.nakedEyePhoto, undefined);
  assert.deepEqual([...pAfter.dermoscopePhotos], []);
  assert.ok(pAfter.imagesPurgedAt instanceof Date);

  const rAfter = await Report.findById(r._id);
  assert.equal(rAfter.editedNakedEyePhoto, undefined);
  assert.deepEqual([...rAfter.editedDermoscopePhotos], []);
  assert.ok(rAfter.imagesPurgedAt instanceof Date);

  // the written record survives
  assert.equal(rAfter.dermoscopeFindings, "findings text");
  assert.equal(rAfter.clinicalImpression, "impression text");
  assert.equal(pAfter.firstname, "P");
  assert.equal(await AuditLog.countDocuments({ action: "retention.images_purged", "target.id": p._id }), 1);
});

test("a recent report is left alone, and a purged case is not purged twice", async () => {
  const recent = await patient({ paymentStatus: "completed", status: "done", createdAt: ago(30), nakedEyePhoto: "patients/keep" });
  await Report.create({ doctor: doctor._id, patient: recent._id, dermoscopeFindings: "x", clinicalImpression: "y", editedNakedEyePhoto: "reports/keep", createdAt: ago(10) });

  const summary = await runRetention();

  assert.equal(summary.imagesPurged, 0, "nothing else should be eligible");
  assert.deepEqual(deleted, [], "no image touched");
  assert.equal((await Patient.findById(recent._id)).nakedEyePhoto, "patients/keep");
});
