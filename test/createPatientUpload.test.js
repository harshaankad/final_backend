// End-to-end POST /api/create-patient with real multipart photos, the way
// the step 3 page sends them. Runs against a throwaway database
// (MONGO_URI_TEST, default local ankad_test); Cloudinary is mocked.
//
//   npm test
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// Test files run concurrently, so each uses its own database.
process.env.MONGO_URI = (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/ankad_test") + "_upload";
process.env.CORS_ORIGINS = "http://localhost:3000";
for (const [k, v] of Object.entries({
  JWT_SECRET: "t".repeat(64),
  MFA_ENCRYPTION_KEY: "a".repeat(64),
  RAZORPAY_KEY_ID: "rzp_test_dummy",
  RAZORPAY_KEY_SECRET: "dummy",
  CLOUD_NAME: "dummy",
  API_KEY: "1",
  API_SECRET: "dummy",
  EMAIL: "test@example.com",
  EMAIL_PASSWORD: "dummy",
})) process.env[k] ||= v;

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const app = require("../app");
const Doctor = require("../models/doctor");
const Patient = require("../models/patient");
const { HEIC_MESSAGE } = require("../utils/imageuploader");

const ORIGIN = "http://localhost:3000";
const PASSWORD = "CorrectHorse1";
const HEIC = fs.readFileSync(path.join(__dirname, "fixtures", "iphone-photo.heic"));
let server, base, cookie, jpeg, png;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Doctor.create({
    firstname: "T", lastname: "Upload", email: "upload@test.local", phone: "1",
    password: await bcrypt.hash(PASSWORD, 4), age: 40, role: "doctor", howDoYouKnowAdmin: "Friend",
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: "upload@test.local", password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("session=")).split(";")[0];

  const canvas = sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 90 } } });
  jpeg = await canvas.clone().jpeg().toBuffer();
  png = await canvas.clone().png().toBuffer();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});

let uploads;
beforeEach(() => {
  mock.restoreAll();
  uploads = [];
  mock.method(cloudinary.uploader, "upload", async (filePath, options) => {
    uploads.push(options);
    return { public_id: `${options.folder}/mock${uploads.length}`, format: "jpg", width: 1, height: 1, bytes: 1 };
  });
});

// Same fields, in the same shape, as src/app/step3/page.js builds them.
const submit = ({ nakedEye, dermoscope }) => {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    firstname: "Asha", lastname: "Rao", age: "34", gender: "female", duration: "2 weeks",
    previousTreatment: "none", clinicalImpression: "", siteOfInfection: "Left Cheek, Nose",
  })) form.append(k, v);
  form.append("nakedEyePhoto", new Blob([nakedEye.buf], { type: nakedEye.type }), nakedEye.name);
  for (const d of dermoscope) form.append("dermoscopePhotos", new Blob([d.buf], { type: d.type }), d.name);
  return fetch(`${base}/api/create-patient`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie }, body: form });
};

const jpg = (name = "clinical.jpg") => ({ buf: jpeg, type: "image/jpeg", name });
const heic = (name = "IMG_0001.HEIC") => ({ buf: HEIC, type: "image/heic", name });

test("a patient with JPEG and PNG photos is created as before", async () => {
  const before = await Patient.countDocuments();
  const res = await submit({ nakedEye: jpg(), dermoscope: [jpg("d1.jpg"), { buf: png, type: "image/png", name: "d2.png" }] });
  const body = await res.json();

  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(await Patient.countDocuments(), before + 1);

  const saved = await Patient.findById(body.data._id).lean();
  assert.equal(saved.firstname, "Asha");
  assert.equal(saved.siteOfInfection, "Left Cheek, Nose");
  assert.equal(saved.paymentStatus, "pending");
  assert.match(saved.nakedEyePhoto, /^patients\/mock\d$/);
  assert.equal(saved.dermoscopePhotos.length, 2);
  assert.equal(uploads.length, 3);
  assert.ok(uploads.every((o) => o.type === "authenticated" && o.folder === "patients"));
});

test("an iPhone HEIC clinical photo gets a clear 400 (not a 500) and no patient is created", async () => {
  const before = await Patient.countDocuments();
  const res = await submit({ nakedEye: heic(), dermoscope: [jpg("d1.jpg")] });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.message, HEIC_MESSAGE);
  assert.equal(await Patient.countDocuments(), before);
  assert.equal(uploads.length, 0);
});

test("a HEIC among the dermoscope photos gets the same clear 400 and no patient is created", async () => {
  const before = await Patient.countDocuments();
  const res = await submit({ nakedEye: jpg(), dermoscope: [jpg("d1.jpg"), heic()] });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.message, HEIC_MESSAGE);
  assert.equal(await Patient.countDocuments(), before);
});

test("a HEIC disguised as .jpg is still caught by its content", async () => {
  const res = await submit({ nakedEye: { buf: HEIC, type: "image/jpeg", name: "photo.jpg" }, dermoscope: [jpg("d1.jpg")] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, HEIC_MESSAGE);
});

test("missing photos are still rejected with the existing message", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    firstname: "Asha", lastname: "Rao", age: "34", gender: "female", duration: "2 weeks",
    previousTreatment: "none", siteOfInfection: "Nose",
  })) form.append(k, v);
  const res = await fetch(`${base}/api/create-patient`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie }, body: form });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /images are required/i);
});
