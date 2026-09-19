const rateLimit = require("express-rate-limit");

const json = (message) => ({
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: message },
});

// Whole API: generous, catches scripted scraping.
exports.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  ...json("Too many requests. Please try again later."),
});

// Credential endpoints (login, OTP, reset, MFA): tight per-IP cap. Per-account
// lockout in the controllers covers distributed attacks.
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  ...json("Too many attempts. Please wait 15 minutes and try again."),
});

// Sending email (OTP / reset) is the most abusable: cap harder.
exports.emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  ...json("Too many emails requested. Please try again in an hour."),
});

// Uploads are expensive (sharp + Cloudinary).
exports.uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  ...json("Too many uploads. Please try again later."),
});
