// Cookies are attached by the browser automatically, so a page on another
// site could try to POST to us with the victim's session. SameSite=Lax
// already blocks that for cross-site POSTs; this is the second lock: every
// state-changing request must carry an Origin (or Referer) from our own
// frontend. Requests authenticated with a Bearer header are exempt — no
// cookie, no CSRF.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const originOf = (req) => {
  const origin = req.get("origin");
  if (origin) return origin;
  const referer = req.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

module.exports = (allowedOrigins) => (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  // Only relevant when a cookie is present at all.
  if (!req.cookies?.session && !req.cookies?.mfa) return next();
  const origin = originOf(req);
  if (origin && allowedOrigins.includes(origin)) return next();
  return res.status(403).json({ success: false, message: "Request blocked: unexpected origin." });
};
