const crypto = require("crypto");

// AES-256-GCM for secrets that must be recoverable (TOTP seeds). Output is
// base64(iv) . base64(authTag) . base64(ciphertext) so a DB dump alone is useless.
const getKey = () => Buffer.from(process.env.MFA_ENCRYPTION_KEY.trim(), "hex");

exports.encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
};

exports.decrypt = (payload) => {
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
};

// One-way hash for tokens we only ever need to compare (reset tokens, backup codes).
exports.sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

// Constant-time string comparison; avoids leaking match length via timing.
exports.safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

exports.randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

// Numeric OTP with a CSPRNG (Math.random is predictable).
exports.randomNumericCode = (digits = 6) => {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
};

// Backup codes: 10 chars from an unambiguous alphabet, shown once, stored hashed.
const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
exports.randomBackupCode = () => {
  let out = "";
  for (let i = 0; i < 10; i++) out += BACKUP_ALPHABET[crypto.randomInt(0, BACKUP_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
};
