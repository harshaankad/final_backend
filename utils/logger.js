const pino = require("pino");

// One JSON line per event. Anything that could carry a credential or
// patient data is redacted at the logger, so a stray log call can't leak it.
module.exports = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.oldPassword",
      "*.newPassword",
      "*.confirmPassword",
      "*.otp",
      "*.code",
      "*.token",
      "*.mfaToken",
    ],
    censor: "[redacted]",
  },
  base: undefined, // no pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
});
