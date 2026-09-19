// Small type guards. Every value read from req.body must pass one of these
// before it touches a Mongo query — objects like {"$gt": ""} are how NoSQL
// injection happens, and express-mongo-sanitize alone only strips the keys.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.isStr = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max;
exports.isEmail = (v) => exports.isStr(v, 254) && EMAIL_RE.test(v);
exports.normalizeEmail = (v) => String(v).trim().toLowerCase();

exports.PASSWORD_MIN = 10;
exports.PASSWORD_MAX = 128;
exports.isPassword = (v) => typeof v === "string" && v.length >= exports.PASSWORD_MIN && v.length <= exports.PASSWORD_MAX;
exports.passwordRule = `Password must be between ${exports.PASSWORD_MIN} and ${exports.PASSWORD_MAX} characters.`;

// 6-digit TOTP or a backup code like ABCDE-23456
exports.isTotpCode = (v) => typeof v === "string" && /^\d{6}$/.test(v.trim());
exports.isBackupCode = (v) => typeof v === "string" && /^[A-Z2-9]{5}-?[A-Z2-9]{5}$/i.test(v.trim());
