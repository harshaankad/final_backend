// Authorisation and abuse-resistance checks. Runs against a throwaway
// database (MONGO_URI_TEST, default local ankad_test) with no external
// services: seeded patients carry no images, so Cloudinary is never called.
//
//   npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// Test files run concurrently, so each uses its own database.
process.env.MONGO_URI = (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/ankad_test") + "_authz";
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
const { generate } = require("otplib");
const app = require("../app");
const Doctor = require("../models/doctor");
const Patient = require("../models/patient");
const AuditLog = require("../models/auditLog");

const ORIGIN = "http://localhost:3000";
const PASSWORD = "CorrectHorse1";
let server, base;
const ids = {};

// ---- tiny cookie-jar client ------------------------------------------------
const client = () => {
  const jar = {};
  const header = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res) => {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(";").map((x) => x.trim());
      const [name, value] = pair.split("=");
      if (!value || attrs.some((a) => /^Expires=Thu, 01 Jan 1970/.test(a))) delete jar[name];
      else jar[name] = value;
    }
    return res.headers.getSetCookie();
  };
  const call = async (method, path, { body, origin = ORIGIN, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(header() ? { Cookie: header() } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = absorb(res);
    return { status: res.status, body: await res.json().catch(() => ({})), setCookies, jar };
  };
  return { call, jar };
};

const login = async (c, email, password = PASSWORD) => c.call("POST", "/api/auth/login", { body: { email, password } });

// ---- fixtures ----------------------------------------------------------------
before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const mk = (email, role = "doctor") =>
    Doctor.create({ firstname: "T", lastname: email.split("@")[0], email, phone: "1", password: hash, age: 40, role, howDoYouKnowAdmin: "Friend" });
  const [a, b, admin] = await Promise.all([mk("a@test.local"), mk("b@test.local"), mk("admin@test.local", "admin")]);
  ids.a = a._id; ids.b = b._id; ids.admin = admin._id;
  const pt = (doctor, extra) =>
    Patient.create({ doctor, firstname: "P", lastname: "X", age: 30, gender: "male", duration: "1w", siteOfInfection: "Arm", previousTreatment: "none", ...extra });
  ids.paidA = (await pt(a._id, { paymentStatus: "completed" }))._id;
  ids.unpaidA = (await pt(a._id, { paymentStatus: "pending" }))._id;
  ids.paidB = (await pt(b._id, { paymentStatus: "completed" }))._id;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});

// ---- tests -------------------------------------------------------------------
test("unauthenticated requests are rejected", async () => {
  const c = client();
  assert.equal((await c.call("GET", "/api/all-patients")).status, 401);
  assert.equal((await c.call("GET", `/api/patient-details/${ids.paidA}`)).status, 401);
  assert.equal((await c.call("GET", "/api/admin-all")).status, 401);
});

test("login sets an httpOnly SameSite cookie and never returns a token", async () => {
  const c = client();
  const r = await login(c, "a@test.local");
  assert.equal(r.status, 200);
  const sc = r.setCookies.find((x) => x.startsWith("session="));
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.doctor.password, undefined);
});

test("NoSQL operators and unknown keys are rejected before any query", async () => {
  const c = client();
  assert.equal((await c.call("POST", "/api/auth/login", { body: { email: { $gt: "" }, password: "x" } })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/login", { body: { email: "a@test.local", password: "x", role: "admin" } })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/resetpassword", { body: { token: { $gt: "" }, password: "LongEnough123", confirmPassword: "LongEnough123" } })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/verify-otp", { body: { firstname: "a", lastname: "b", email: "x@y.z", phone: "1", password: "LongEnough123", age: 30, howDoYouKnowAdmin: "Friend", otp: { $gt: "" } } })).status, 400);
});

test("wrong password and unknown email give the same answer", async () => {
  const c = client();
  const r1 = await login(c, "a@test.local", "nope-nope-nope");
  const r2 = await login(c, "ghost@test.local", "nope-nope-nope");
  assert.equal(r1.status, 401);
  assert.deepEqual(r1.body, r2.body);
});

test("a doctor cannot read, pay for, or delete another doctor's patient", async () => {
  const c = client();
  await login(c, "a@test.local");
  assert.equal((await c.call("GET", `/api/patient-details/${ids.paidA}`)).status, 200);
  assert.equal((await c.call("GET", `/api/patient-details/${ids.paidB}`)).status, 404);
  assert.equal((await c.call("POST", "/api/create-payment", { body: { patientId: String(ids.paidB) } })).status, 404);
  assert.equal((await c.call("DELETE", `/api/patient/${ids.paidB}`)).status, 404);
  assert.equal((await c.call("GET", "/api/patient-details/not-an-id")).status, 400);
});

test("doctor may delete own unpaid patient but not a completed case", async () => {
  const c = client();
  await login(c, "a@test.local");
  assert.equal((await c.call("DELETE", `/api/patient/${ids.paidA}`)).status, 403);
  assert.equal((await c.call("DELETE", `/api/patient/${ids.unpaidA}`)).status, 200);
  assert.equal(await Patient.countDocuments({ _id: ids.unpaidA }), 0);
});

test("doctor cannot reach admin routes; admin can read any patient", async () => {
  const c = client();
  await login(c, "a@test.local");
  assert.equal((await c.call("GET", "/api/admin-all")).status, 403);
  assert.equal((await c.call("GET", "/api/admin-audit")).status, 403);
  assert.equal((await c.call("DELETE", `/api/admin-doctor/${ids.b}`)).status, 403);
  const admin = client();
  await login(admin, "admin@test.local");
  assert.equal((await admin.call("GET", `/api/patient-details/${ids.paidB}`)).status, 200);
  const list = await admin.call("GET", "/api/admin-all");
  assert.equal(list.status, 200);
  assert.ok(list.body.data.every((p) => !("nakedEyePhoto" in p)), "list endpoints must not carry image fields");
});

test("cookie-authenticated mutations require our Origin (CSRF)", async () => {
  const c = client();
  await login(c, "a@test.local");
  assert.equal((await c.call("POST", "/api/auth/mfa/setup", { origin: "https://evil.example" })).status, 403);
  assert.equal((await c.call("POST", "/api/auth/mfa/setup", { origin: null })).status, 403);
  assert.equal((await c.call("POST", "/api/auth/mfa/setup")).status, 200);
});

test("MFA: enrol, then login needs a code; stage cookie is powerless; replay rejected", async () => {
  const c = client();
  await login(c, "b@test.local");
  const setup = await c.call("POST", "/api/auth/mfa/setup");
  const key = setup.body.manualKey;
  const code = await generate({ secret: key });
  const confirm = await c.call("POST", "/api/auth/mfa/confirm", { body: { code } });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.backupCodes.length, 8);

  const c2 = client();
  const r = await login(c2, "b@test.local");
  assert.equal(r.body.mfaRequired, true);
  assert.ok(!c2.jar.session, "no session cookie before the code");
  assert.equal((await c2.call("GET", "/api/me")).status, 401);
  assert.equal((await c2.call("POST", "/api/auth/mfa/setup")).status, 401);
  assert.equal((await c2.call("POST", "/api/auth/mfa/verify", { body: { code } })).status, 401, "same code as enrolment must be rejected (replay)");
  const v = await c2.call("POST", "/api/auth/mfa/verify", { body: { code: confirm.body.backupCodes[0] } });
  assert.equal(v.status, 200);
  assert.ok(c2.jar.session && !c2.jar.mfa);
  assert.equal((await c2.call("GET", "/api/me")).status, 200);

  const c3 = client();
  await login(c3, "b@test.local");
  assert.equal((await c3.call("POST", "/api/auth/mfa/verify", { body: { code: confirm.body.backupCodes[0] } })).status, 401, "backup code is single-use");
});

test("logout clears the cookie and revokes every session", async () => {
  const c1 = client();
  const c2 = client();
  await login(c1, "a@test.local");
  await login(c2, "a@test.local");
  const r = await c1.call("POST", "/api/auth/logout");
  assert.equal(r.status, 200);
  assert.ok(!c1.jar.session);
  assert.equal((await c2.call("GET", "/api/me")).status, 401, "other device's session revoked too");
});

test("five wrong passwords lock the account", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await login(c, "a@test.local", "wrong-wrong-wrong");
  const r = await login(c, "a@test.local");
  assert.equal(r.status, 423);
  await Doctor.updateOne({ _id: ids.a }, { failedLoginAttempts: 0, $unset: { lockUntil: 1 } });
});

test("audit trail records logins, failures and patient views without secrets", async () => {
  const rows = await AuditLog.find().lean();
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["login.success", "login.failed", "login.locked", "patient.viewed", "patient.deleted", "patient.delete_denied", "mfa.enabled", "logout"]) {
    assert.ok(actions.has(a), `missing audit action ${a}`);
  }
  assert.ok(!JSON.stringify(rows).includes(PASSWORD));
});

test("create-patient requires explicit consent", async () => {
  const c = client();
  await login(c, "a@test.local");
  const body = { firstname: "P", lastname: "Q", age: 30, gender: "male", duration: "1w", siteOfInfection: "Arm", previousTreatment: "none" };
  const r = await c.call("POST", "/api/create-patient", { body });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /consent/i);
});

test("admin can erase any patient; the audit log records it", async () => {
  const admin = client();
  await login(admin, "admin@test.local");
  const r = await admin.call("DELETE", `/api/patient/${ids.paidB}`);
  assert.equal(r.status, 200);
  assert.equal(await Patient.countDocuments({ _id: ids.paidB }), 0);
  assert.equal(await AuditLog.countDocuments({ action: "patient.deleted", "target.id": ids.paidB, actorRole: "admin" }), 1);
  assert.equal((await admin.call("DELETE", `/api/admin-doctor/${ids.admin}`)).status, 400, "cannot delete self");
});

test("MFA can be turned off only with password + current code", async () => {
  // b@test.local was enrolled in the MFA test. Read its secret straight from
  // the DB to mint codes, waiting for a fresh 30s step each time so the
  // replay guard doesn't reject them.
  const { decrypt } = require("../utils/crypto");
  const doc = await Doctor.findById(ids.b).select("+mfaSecret");
  assert.ok(doc.mfaEnabled);
  const freshCode = async () => {
    const step = Math.floor(Date.now() / 1000 / 30);
    while (Math.floor(Date.now() / 1000 / 30) === step) await new Promise((r) => setTimeout(r, 250));
    return generate({ secret: decrypt(doc.mfaSecret) });
  };

  const c = client();
  await login(c, "b@test.local");
  assert.equal((await c.call("POST", "/api/auth/mfa/verify", { body: { code: await freshCode() } })).status, 200);

  const wrong = await c.call("POST", "/api/auth/mfa/disable", { body: { password: "not-the-password", code: await freshCode() } });
  assert.equal(wrong.status, 401);

  const ok = await c.call("POST", "/api/auth/mfa/disable", { body: { password: PASSWORD, code: await freshCode() } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.doctor.mfaEnabled, false);

  const again = client();
  const r = await login(again, "b@test.local");
  assert.equal(r.body.mfaRequired, undefined);
  assert.ok(again.jar.session, "password alone signs in once MFA is off");
});
