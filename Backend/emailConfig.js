import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify connection
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email configuration error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// Email template function
const createEmailTemplate = (to, subject, htmlContent) => {
  return {
    from: `"CampusFind" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };
};

// Send email function
const sendEmail = async (to, subject, htmlContent) => {
  try {
    const mailOptions = createEmailTemplate(to, subject, htmlContent);
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// OTP Email function
const sendOTPEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: `"CampusFind" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'CampusFind - OTP Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background: white;">
          <div style="text-align: center; margin-bottom: 30px; padding: 20px; background: linear-gradient(135deg, #0d6efd, #0a58ca); border-radius: 10px; color: white;">
            <h1 style="margin: 0; font-size: 28px;">CampusFind</h1>
            <p style="margin: 5px 0; opacity: 0.9;">Lost & Found System</p>
          </div>
          
          <h2 style="color: #333; text-align: center; margin-bottom: 25px;">OTP Verification Code</h2>
          
          <p style="font-size: 16px; color: #555;">Hello,</p>
          <p style="font-size: 16px; color: #555;">Thank you for registering with CampusFind. Your One-Time Password (OTP) for student verification is:</p>
          
          <div style="text-align: center; margin: 40px 0;">
            <div style="font-size: 42px; font-weight: bold; color: #0d6efd; letter-spacing: 15px; padding: 20px; background: #f8f9fa; border: 2px dashed #0d6efd; border-radius: 12px; display: inline-block; min-width: 200px;">
              ${otp}
            </div>
          </div>
          
          <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #0d6efd;">
            <p style="margin: 0; font-size: 14px; color: #0a58ca;">
              <strong>Important:</strong> This OTP is valid for <strong>10 minutes</strong>. Do not share this code with anyone.
            </p>
          </div>
          
          <p style="font-size: 16px; color: #555;">If you didn't request this OTP, please ignore this email.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="text-align: center; color: #6c757d; font-size: 14px; margin: 0;">
              <strong>CampusFind - Lost & Found System</strong><br>
              Secure Student Registration Portal<br>
              Email: ${process.env.EMAIL_USER}
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent to ${email}`);
    console.log(`📧 Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Detailed email error:', error);
    console.log(`\n⚠️  EMAIL FAILED - OTP for ${email}: ${otp}`);
    console.log(`📝 You can manually enter this OTP: ${otp}\n`);
    
    return false;
  }
};

// Welcome Email function
const sendWelcomeEmail = async (to, userName) => {
  const subject = 'Welcome to CampusFind!';
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">Welcome to CampusFind, ${userName}! 🎉</h2>
      <p>We're excited to have you on board. Your account has been successfully created.</p>
      <p>Start exploring your campus community today!</p>
      <br>
      <p>Best regards,<br>The CampusFind Team</p>
    </div>
  `;
  
  return await sendEmail(to, subject, htmlContent);
};

export {
  transporter,
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail
};