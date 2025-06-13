require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authroutes = require("./routes/authroutes");
const patientroute=require("./routes/patientroute");
const paymentroute=require("./routes/paymentroute")
const adminroute=require("./routes/adminroute")
const qualificationPicroute=require("./routes/qualificationPicroute")
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const cloudinary = require("cloudinary").v2;

const app = express();

// Middleware
app.use(express.json());

app.use(cookieParser());

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));


app.use(express.urlencoded({ extended: true })); // For form-urlencoded data
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" })); // For file uploads

// Connect MongoDB
connectDB();

//Setup of cloudinary

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
