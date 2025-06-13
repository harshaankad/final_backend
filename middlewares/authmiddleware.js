const jwt = require("jsonwebtoken");
const Doctor = require("../models/doctor");

// ✅ Authentication Middleware: Verify JWT Token
exports.auth = async (req, res, next) => {
  try {
    // Extract token from cookies, body, or Authorization header
    let token =
      req.cookies?.token ||
      req.body?.token ||
      (req.header("Authorization") && req.header("Authorization").startsWith("Bearer ")
        ? req.header("Authorization").replace("Bearer ", "")
        : null);

    if (!token) {
      return res.status(401).json({ error: "Unauthorized. No token provided." });
    }

    // Verify token with secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecretkey");

    // 🔥 FIX: Use doctorId consistently
    req.doctorId = decoded.doctorId;
    req.role = decoded.role;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({ error: "Invalid or expired token." });
  }
};

// ✅ Authorization Middleware: Check if User is a Doctor
exports.isDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.findById(req.doctorId); // 🔥 Fixed

    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    if (doctor.role !== "doctor") {
      return res.status(403).json({ error: "Access denied. Doctors only." });
    }

    next();
  } catch (error) {
    console.error("isDoctor middleware error:", error);
    res.status(500).json({ error: "Server error checking doctor role." });
  }
};

// ✅ Authorization Middleware: Check if User is an Admin
exports.isAdmin = async (req, res, next) => {
  try {
    const doctor = await Doctor.findById(req.doctorId); // 🔥 Fixed

    if (!doctor) {
      return res.status(404).json({ error: "User not found." });
    }

    if (doctor.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    next();
  } catch (error) {
    console.error("isAdmin middleware error:", error);
    res.status(500).json({ error: "Server error checking admin role." });
  }
};