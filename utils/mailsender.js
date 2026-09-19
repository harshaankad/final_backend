const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const FROM = `"DermaDrishti" <${process.env.EMAIL}>`;

const shell = (title, body) => `
  <html>
    <body style="margin:0; padding:0; font-family: 'Segoe UI', sans-serif; background-color:#F4F8F5;">
      <div style="max-width:600px; margin:40px auto; background:#ffffff; border-radius:15px; padding:30px; text-align:center; box-shadow:0 5px 15px rgba(0,0,0,0.1);">
        <h1 style="color:#5F8D4E; margin-bottom:10px;">DermaDrishti</h1>
        <p style="color:#242424; margin-bottom:25px;">${title}</p>
        ${body}
        <div style="margin-top:30px;">
          <p style="color:#242424; font-size:12px;">© ${new Date().getFullYear()} Ankad Cutiscience. All rights reserved.</p>
        </div>
      </div>
    </body>
  </html>`;

exports.sendOtpEmail = async (email, otp) => {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: "Your verification code for DermaDrishti",
    html: shell(
      "Welcome! Use the code below to verify your account.",
      `<div style="font-size:36px; font-weight:bold; color:#4A7A3A; letter-spacing:8px; margin:20px 0;">${otp}</div>
       <p style="color:#555; font-size:14px; line-height:1.6;">This code is valid for <strong>5 minutes</strong>. Please do not share it with anyone.</p>`
    ),
  });
};

// Sent instead of an OTP when someone tries to sign up with an email that is
// already registered, so the signup endpoint gives nothing away.
exports.sendAccountExistsEmail = async (email) => {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: "You already have a DermaDrishti account",
    html: shell(
      "Someone just tried to sign up with this email address.",
      `<p style="color:#555; font-size:14px; line-height:1.6;">An account with this email already exists. If that was you, simply log in. If you forgot your password, use <strong>Forgot password</strong> on the login page.<br><br>If this wasn't you, no action is needed.</p>`
    ),
  });
};

exports.sendResetEmail = async (email, url) => {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: "Reset your DermaDrishti password",
    html: shell(
      "We received a request to reset your password.",
      `<p style="margin:20px 0;"><a href="${url}" style="display:inline-block; background:#285430; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600;">Reset password</a></p>
       <p style="color:#555; font-size:14px; line-height:1.6;">This link is valid for <strong>1 hour</strong> and can be used once. If you didn't request a reset, you can ignore this email.</p>`
    ),
  });
};
