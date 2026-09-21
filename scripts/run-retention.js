#!/usr/bin/env node
// Run the retention pass once and exit (for a cron job or a manual run).
require("dotenv").config();
const mongoose = require("mongoose");
const { runRetention } = require("../jobs/retention");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const summary = await runRetention();
  console.log(JSON.stringify(summary));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
