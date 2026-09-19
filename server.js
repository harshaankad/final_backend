require("dotenv").config();
const { assertEnv } = require("./utils/env");
assertEnv(); // exit before anything else if secrets are missing/weak

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const connectDB = require("./config/db");
const authroutes = require("./routes/authroutes");
const patientroute = require("./routes/patientroute");
const paymentroute = require("./routes/paymentroute");
const adminroute = require("./routes/adminroute");
const qualificationPicroute = require("./routes/qualificationPicroute");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const cloudinary = require("cloudinary").v2;
const { globalLimiter } = require("./middlewares/rateLimiters");
const cleanupTempFiles = require("./middlewares/cleanupTempFiles");

const app = express();

// Behind Render's proxy: needed so req.ip (rate limiting) is the client, not the proxy.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());

// CORS configuration
const allowedOrigins = [
  "http://localhost:3000",      // Local testing
  "https://www.ankad.in"            // Your live frontend
];

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(globalLimiter);

// Body parsing — small limits; images come through multipart, not JSON.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

// Strip `$` and `.` from keys in body/query/params so operators like
// {"$gt": ""} can never reach a Mongo query.
app.use(mongoSanitize());

// For file uploads
// Per-file size cap so an oversized request fails fast with a clear message
// instead of exhausting server memory. Cloudinary's free-plan cap is 10 MB;
// anything between 10 and 20 MB gets compressed by imageuploader.js first.
const MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: "/tmp/",
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE, files: 12 },
  abortOnLimit: true,
  limitHandler: (req, res) => {
    if (res.headersSent) return;
    res.status(413).json({
      success: false,
      message: "One of the images is larger than 20 MB. Please use a smaller image and try again.",
    });
  },
}));
app.use(cleanupTempFiles);

// Connect MongoDB
connectDB();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Routes
app.use("/api/auth", authroutes);
app.use("/api", patientroute);
app.use("/api", paymentroute);
app.use("/api", adminroute);
app.use("/api", qualificationPicroute);

// Default Route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Central error handler: never echo internals to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin not allowed." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large." });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, message: "Something went wrong." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
