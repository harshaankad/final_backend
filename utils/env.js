// Fail fast on missing/weak secrets instead of silently falling back to
// insecure defaults. Called once at startup before anything else loads.

const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "MFA_ENCRYPTION_KEY",
  "CLOUD_NAME",
  "API_KEY",
  "API_SECRET",
  "EMAIL",
  "EMAIL_PASSWORD",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
];

function assertEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim());
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (process.env.JWT_SECRET.trim().length < 32) {
    console.error("❌ JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32");
    process.exit(1);
  }

  // 32 bytes hex-encoded = 64 hex chars (AES-256 key)
  if (!/^[0-9a-fA-F]{64}$/.test(process.env.MFA_ENCRYPTION_KEY.trim())) {
    console.error("❌ MFA_ENCRYPTION_KEY must be 64 hex characters. Generate one with: openssl rand -hex 32");
    process.exit(1);
  }
}

module.exports = { assertEnv };
