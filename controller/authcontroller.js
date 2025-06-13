const OTP = require("../models/otp");
const sendOtpEmail = require("../utils/mailsender");
const Doctor = require("../models/doctor");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ✅ Generate & Send OTP
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    console.log("📩 sendOtp controller hit");

    if(!email){
      return res.status(400).json({ error: "Please enter email" });
    }

    const userexists= await Doctor.findOne({email});
    if(userexists){
      return res.status(400).json({ error: "User already exists" });
    }

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email });

    // Generate a 4-digit OTP
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    console.log("Generated OTP:", otpCode);

    // Save OTP to database
    await OTP.create({ email, otp: otpCode });

    // Send OTP via email
    await sendOtpEmail(email, otpCode);

    res.status(200).json({ message: "OTP sent successfully." });
  } catch (error) {
    res.status(500).json({ error: "Error sending OTP." });
  }
};

// ✅ Verify OTP & Register Doctor
exports.verifyOtp = async (req, res) => {
  try {
    const { firstname, lastname, email, phone, password, age, qualificationPic, howDoYouKnowAdmin, otp } = req.body;

    if(!firstname || !lastname || !email || !phone || !password || !age || !howDoYouKnowAdmin){
      return res.status(400).json({ error: "Please enter all details" });
    }

    const userexists= await Doctor.findOne({email});

    if(userexists){
      return res.status(400).json({ error: "User already exists" });
    }

    // Check if OTP exists & is valid
    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new doctor
    const newDoctor = await Doctor.create({
      firstname,
      lastname,
      email,
      phone,
      password: hashedPassword,
      age,
      qualificationPic,
      howDoYouKnowAdmin,
    });

    // Delete OTP after successful signup
    await OTP.deleteMany({ email });

    res.status(201).json({ message: "Signup successful!", doctorId: newDoctor._id });
  } catch (error) {
    res.status(500).json({ error: "Error verifying OTP." });
  }
}; // ✅ Correctly closing verifyOtp function

// ✅ Login Controller (Using Cookies)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("hit login api");

    if (!email || !password) {
      return res.status(400).json({ error: "Please fill all details" });
    }

    // 1️⃣ Check if doctor exists
    const doctor = await Doctor.findOne({ email });
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found. Please sign up." });
    }

    // 2️⃣ Compare entered password with hashed password
    const isMatch = await bcrypt.compare(password, doctor.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // 3️⃣ Generate JWT Token
    const token = jwt.sign(
      { doctorId: doctor._id, role: doctor.role },
      process.env.JWT_SECRET || "supersecretkey",
      { expiresIn: "1d" }
    );

    // Remove password before sending doctor data
    const doctorData = doctor.toObject();
    delete doctorData.password;

    // 4️⃣ Send token and doctor data in response body
    res.status(200).json({
      success: true,
      token,
      doctor: doctorData,
      message: "User Login Success",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Error logging in." });
  }
};

//Change password

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(404).json({ error: "PLease enter both old and new password" });
    }

    const doctorId = req.doctorId; // Extracted from JWT in middleware

    if (!doctorId) {
      return res.status(404).json({ error: "DoctorId not found" });
    }

    // 🔍 1️⃣ Find the doctor
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    // 🔑 2️⃣ Check if old password is correct
    const isMatch = await bcrypt.compare(oldPassword, doctor.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect old password." });
    }

    // 🔒 3️⃣ Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 💾 4️⃣ Update the password
    doctor.password = hashedPassword;
    await doctor.save();

    res.status(200).json({ message: "Password changed successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Error changing password." });
  }
};


