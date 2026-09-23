// The report-ready email to the doctor. The mailer is mocked, so nothing is
// ever sent; what matters is who it would go to, where the link points, and
// that a mail failure can never surface as an error to the caller.
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// Test files run concurrently, so each uses its own database.
process.env.MONGO_URI = (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/ankad_test") + "_notify";
process.env.FRONTEND_URL = "https://www.example.test/";
for (const [k, v] of Object.entries({ JWT_SECRET: "t".repeat(64), MFA_ENCRYPTION_KEY: "a".repeat(64), CLOUD_NAME: "dummy", API_KEY: "1", API_SECRET: "dummy", EMAIL: "t@example.com", EMAIL_PASSWORD: "x" })) process.env[k] ||= v;

const mongoose = require("mongoose");
const Doctor = require("../models/doctor");
const Patient = require("../models/patient");
const Report = require("../models/report");
const mailer = require("../utils/mailsender");
const { notifyDoctorReportReady } = require("../services/reportNotifications");

let doctor, patient, report, send;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  doctor = await Doctor.create({ firstname: "Asha", lastname: "Rao", email: "asha@test.local", phone: "1", password: "x", age: 40, howDoYouKnowAdmin: "Friend" });
  patient = await Patient.create({ doctor: doctor._id, firstname: "Priya", lastname: "<b>Sharma</b>", age: 30, gender: "female", paymentStatus: "completed", status: "done" });
  report = await Report.create({ doctor: doctor._id, patient: patient._id, reportStatus: "completed" });
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(() => {
  mock.restoreAll();
  send = mock.method(mailer, "sendReportReadyEmail", async () => {});
});

test("emails the submitting doctor with a login-gated link to the report", async () => {
  assert.equal(await notifyDoctorReportReady(patient, report), true);
  assert.equal(send.mock.callCount(), 1);
  const [args] = send.mock.calls[0].arguments;
  assert.equal(args.to, "asha@test.local");
  assert.equal(args.doctorName, "Asha Rao");
  assert.equal(args.patientName, "Priya <b>Sharma</b>");
  assert.equal(args.reportUrl, `https://www.example.test/report/${patient._id}`); // trailing slash trimmed
});

test("a mail failure is swallowed and reported as not sent", async () => {
  send = mock.method(mailer, "sendReportReadyEmail", async () => { throw new Error("SMTP down"); });
  assert.equal(await notifyDoctorReportReady(patient, report), false);
  assert.equal(send.mock.callCount(), 1);
});

test("no email when the doctor no longer exists", async () => {
  const orphan = { _id: new mongoose.Types.ObjectId(), doctor: new mongoose.Types.ObjectId(), firstname: "X", lastname: "Y" };
  assert.equal(await notifyDoctorReportReady(orphan, report), false);
  assert.equal(send.mock.callCount(), 0);
});

test("names are HTML-escaped in the rendered email", async () => {
  const html = await renderReportReadyHtml({ doctorName: "Asha <script>", patientName: "Priya <b>Sharma</b>", reportUrl: "https://www.example.test/report/1" });
  assert.match(html, /Dr\. Asha &lt;script&gt;/);
  assert.match(html, /Priya &lt;b&gt;Sharma&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/www\.example\.test\/report\/1"/);
  assert.doesNotMatch(html, /<script>/);
});

// mailsender.js builds its Gmail transporter at require time. Load a private
// copy of the module with createTransport swapped for a capturing stub, so we
// see exactly the HTML it would hand to SMTP. The copy the service holds is
// untouched, and the cache entry is dropped again afterwards.
async function renderReportReadyHtml(fields) {
  const nodemailer = require("nodemailer");
  const path = require.resolve("../utils/mailsender");
  const captured = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => ({ sendMail: async (opts) => { captured.push(opts); } });
  delete require.cache[path];
  try {
    await require(path).sendReportReadyEmail({ to: "asha@test.local", ...fields });
  } finally {
    nodemailer.createTransport = original;
    delete require.cache[path];
  }
  return captured[0].html;
}
