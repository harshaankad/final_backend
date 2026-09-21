const { z } = require("zod");
const { PASSWORD_MIN, PASSWORD_MAX } = require("../utils/validate");

// Every request body is parsed against one of these before a controller
// runs. `.strict()` rejects keys we don't expect (mass-assignment guard);
// multipart forms use `.strip()` because browsers/FormData are noisier.

const email = z.string().trim().toLowerCase().max(254).email("Please enter a valid email.");
const password = z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX);
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");
const totp = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");
const backupCode = z.string().trim().regex(/^[A-Za-z2-9]{5}-?[A-Za-z2-9]{5}$/, "Invalid backup code.");
const shortText = (max) => z.string().trim().min(1).max(max);

exports.sendOtp = z.object({ email }).strict();

exports.verifyOtp = z
  .object({
    firstname: shortText(100),
    lastname: shortText(100),
    email,
    phone: shortText(20),
    password,
    age: z.coerce.number().int().min(18).max(120),
    qualificationPic: z.string().max(500).optional().or(z.literal("")),
    howDoYouKnowAdmin: z.enum(["Family", "Friend", "Colleague", "No Direct Connection"]),
    otp: z.string().regex(/^\d{6}$/, "Invalid or expired OTP."),
  })
  .strict();

exports.login = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) }).strict();

exports.mfaCode = z.object({ code: totp }).strict();
exports.mfaLoginCode = z.object({ code: z.union([totp, backupCode]) }).strict();
exports.mfaDisable = z.object({ password: z.string().min(1).max(PASSWORD_MAX), code: z.union([totp, backupCode]) }).strict();

exports.changePassword = z
  .object({ oldPassword: z.string().min(1).max(PASSWORD_MAX), newPassword: password })
  .strict();

exports.resetPasswordToken = z.object({ email }).strict();

exports.resetPassword = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/, "Reset link is invalid or has expired."),
    password,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((d) => d.password === d.confirmPassword, { message: "Password and confirm password do not match.", path: ["confirmPassword"] });

exports.createPayment = z.object({ patientId: objectId }).strict();

exports.verifyPayment = z
  .object({
    razorpay_order_id: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    razorpay_payment_id: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict();

// multipart text fields (files are checked separately in the controller)
exports.createPatient = z
  .object({
    firstname: shortText(100),
    lastname: shortText(100),
    age: z.coerce.number().int().min(0).max(120),
    gender: z.enum(["male", "female", "other"]),
    duration: shortText(200),
    siteOfInfection: shortText(500),
    previousTreatment: shortText(2000),
    clinicalImpression: z.string().trim().max(2000).optional().or(z.literal("")),
    // FormData sends strings; the checkbox must be explicitly ticked.
    consent: z.literal("true", { message: "Patient consent must be confirmed before uploading." }),
  })
  .strip();

exports.generateReport = z
  .object({
    dermoscopeFindings: shortText(5000),
    clinicalImpression: shortText(5000),
  })
  .strip();

exports.analyticsQuery = z.object({ range: z.enum(["30d", "90d", "12m", "all"]).optional() }).strip();

exports.auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.string().datetime().optional(),
    action: z.string().max(60).optional(),
    actor: objectId.optional(),
    targetId: objectId.optional(),
  })
  .strip();

exports.params = { objectId };
