require("dotenv").config();
const { assertEnv } = require("./utils/env");
assertEnv(); // exit before anything else if secrets are missing/weak

const connectDB = require("./config/db");
const app = require("./app");
const logger = require("./utils/logger");
const { startJobs } = require("./jobs");

connectDB();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "server started");
  startJobs();
});
