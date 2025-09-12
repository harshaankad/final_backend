const nodemailer = require("nodemailer");

// ✅ Function to send OTP email
const sendOtpEmail = async (email, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD, 
      },
    });

    const mailOptions = {
      from: '"Ankad Cutiscience" <harsha02122003@gmail.com>',
      to: email,
      subject: "Your OTP for Ankad Cutiscience",
      html: `
        <html>
          <body style="margin:0; padding:0; font-family: 'Segoe UI', sans-serif; background-color:#F4F8F5;">
            <div style="max-width:600px; margin:40px auto; background:#ffffff; border-radius:15px; padding:30px; text-align:center; box-shadow:0 5px 15px rgba(0,0,0,0.1);">
              
              <h1 style="color:#5F8D4E; margin-bottom:10px;">🧪 Ankad Cutiscience</h1>
              <p style="color:#242424; margin-bottom:25px;">Welcome! Use the OTP below to verify your account.</p>
              
              <div style="font-size:36px; font-weight:bold; color:#4A7A3A; letter-spacing:8px; margin:20px 0;">
                ${otp}
              </div>
              
              <p style="color:#555; font-size:14px; line-height:1.6;">
                This OTP is valid for <strong>5 minutes</strong>. Please do not share it with anyone.
              </p>
              
              <div style="margin-top:30px;">
                <p style="color:#242424; font-size:12px;">
                  © ${new Date().getFullYear()} Ankad Cutiscience. All rights reserved.
                </p>
              </div>

            </div>
          </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ OTP Email sent:", info.response);
    return info;
  } catch (error) {
    console.error("❌ Error sending OTP email:", error);
    throw error;
  }
};

module.exports = sendOtpEmail;
