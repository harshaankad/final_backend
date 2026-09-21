const rateLimit = require("express-rate-limit");

// Per-IP backstops. The real brute-force defence is the per-account lockout
// in the controllers (5 wrong passwords / codes → 15 min); these only cap
// how fast one address can hammer us. Because several doctors may share one
// clinic IP, successful requests are NOT counted — only failures — so
// legitimate use never trips them.
const base = (message) => ({
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: message },
  // The test suite hammers auth endpoints from one IP.
  skip: () => process.env.NODE_ENV === "test",
});

// Whole API: generous, catches scripted scraping.
exports.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  ...base("Too many requests. Please try again later."),
});

// Password / code checks: 30 *failed* attempts per IP per 15 minutes.
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  ...base("Too many failed attempts from this network. Please wait 15 minutes and try again."),
});

exports.mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  ...base("Too many failed code attempts from this network. Please wait 15 minutes and try again."),
});

// Other credential endpoints (signup OTP check, password change/reset).
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  ...base("Too many attempts. Please wait 15 minutes and try again."),
});

// Sending email (OTP / reset) is the most abusable: cap regardless of outcome.
exports.emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  ...base("Too many emails requested from this network. Please try again in an hour."),
});

// Uploads are expensive (sharp + Cloudinary).
exports.uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  ...base("Too many uploads. Please try again later."),
});
