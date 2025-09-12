const express = require("express");
const { sendOtp, verifyOtp ,login, changePassword ,logoutController} = require("../controller/authcontroller");
const {auth, isDoctor, isAdmin}=require("../middlewares/authmiddleware")
const {resetPasswordToken, resetPassword}=require("../controller/resetpassword")

const router = express.Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/login", login);
router.post("/change-password",changePassword);
router.post("/logout",auth ,logoutController);


router.post("/resetpasswordtoken", resetPasswordToken);
router.post("/resetpassword", resetPassword);

module.exports = router;
