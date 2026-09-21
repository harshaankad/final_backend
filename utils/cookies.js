// Session and MFA-pending tokens travel in httpOnly cookies, so page scripts
// (and therefore any XSS) can never read them. SameSite=Lax means browsers
// only attach them to same-site requests: the API must be served from a
// subdomain of the frontend's site (api.ankad.in ↔ www.ankad.in), or from
// localhost in development.
const isProd = process.env.NODE_ENV === "production";

const SESSION_COOKIE = "session";
const MFA_COOKIE = "mfa";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MFA_MAX_AGE_MS = 5 * 60 * 1000;

const base = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
};

exports.SESSION_COOKIE = SESSION_COOKIE;
exports.MFA_COOKIE = MFA_COOKIE;

exports.setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, { ...base, maxAge: SESSION_MAX_AGE_MS });
};

exports.clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, base);
};

// Scoped to the MFA routes so it is never sent anywhere else.
const mfaBase = { ...base, path: "/api/auth/mfa" };

exports.setMfaCookie = (res, token) => {
  res.cookie(MFA_COOKIE, token, { ...mfaBase, maxAge: MFA_MAX_AGE_MS });
};

exports.clearMfaCookie = (res) => {
  res.clearCookie(MFA_COOKIE, mfaBase);
};
