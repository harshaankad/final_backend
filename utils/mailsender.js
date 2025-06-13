const nodemailer = require("nodemailer");

// ✅ Function to send OTP email
const sendOtpEmail = async (email, otp) => {
  try {
    // Create a transporter (Use your email credentials)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "harsha02122003@gmail.com", // Replace with your email
        pass: "byzg xzhf mqie cvsz", // Use an app password, NOT your main password
      },
    });

    // Email options
    const mailOptions = {
      from: "harsha02122003@gmail.com",
      to: email,
      subject: "Your OTP Code",
      html: `<p>Your OTP for verification is: <strong>${otp}</strong></p>
             <p>This OTP is valid for 5 minutes.</p>`,
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ OTP Email sent: ", info.response);
    return info;
  } catch (error) {
    console.error("❌ Error sending OTP email:", error);
    throw error;
  }
};




module.exports = sendOtpEmail;
