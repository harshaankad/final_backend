const { runRetention } = require("./retention");
const { checkSecurityAlerts } = require("./securityAlerts");
const logger = require("../utils/logger");

// In-process schedulers. The service runs as a single instance, so this is
// enough; if it is ever scaled out, move these to a Render cron job calling
// `node scripts/run-retention.js`.
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ALERT_INTERVAL_MS = 5 * 60 * 1000;

const safe = (name, fn) => () => fn().catch((err) => logger.error({ err: err.message }, `${name} job failed`));

exports.startJobs = () => {
  if (process.env.RETENTION_ENABLED !== "false") {
    setTimeout(safe("retention", runRetention), 60 * 1000); // first run a minute after boot
    setInterval(safe("retention", runRetention), RETENTION_INTERVAL_MS).unref();
    logger.info("retention job scheduled (daily)");
  } else {
    logger.warn("retention job DISABLED via RETENTION_ENABLED=false");
  }
  setInterval(safe("securityAlerts", checkSecurityAlerts), ALERT_INTERVAL_MS).unref();
};
