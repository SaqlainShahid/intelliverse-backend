// utils/emailService.js - Corrected file
const nodemailer = require('nodemailer');

// Create transporter - FIXED: createTransport (not createTransporter)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify email configuration
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email service is ready');
    return true;
  } catch (error) {
    console.error('❌ Email service error:', error.message);
    return false;
  }
};

// Signup email template
const getSignupEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">🎓 Welcome to IntelliVerse</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">Smart Campus Companion</p>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
        <p style="margin-bottom: 20px;">Welcome to IntelliVerse! Please verify your account with the code below:</p>
        
        <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px;">Your Verification Code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${otpCode}</div>
        </div>
        
        <p><strong>Important:</strong></p>
        <ul>
          <li>This code will expire in 15 minutes</li>
          <li>Don't share this code with anyone</li>
          <li>If you didn't request this, please ignore this email</li>
        </ul>
        
        <p>Welcome to the future of campus life! 🚀</p>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 14px;">
        <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
        <p>This is an automated message, please do not reply.</p>
      </div>
    </body>
    </html>
  `;
};

// Login email template
const getLoginEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login Verification - IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">🔐 Login Verification</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">IntelliVerse Smart Campus</p>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
        <p style="margin-bottom: 20px;">Someone is trying to login to your IntelliVerse account. Use the code below to complete the login:</p>
        
        <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px;">Your Login Code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${otpCode}</div>
        </div>
        
        <p><strong>Security Notice:</strong></p>
        <ul>
          <li>This code will expire in 15 minutes</li>
          <li>If this wasn't you, please change your password immediately</li>
          <li>Never share this code with anyone</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 14px;">
        <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
        <p>This is an automated message, please do not reply.</p>
      </div>
    </body>
    </html>
  `;
};

// Forgot password email template
const getForgotPasswordEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
        <p style="color: #f0f0f0; margin: 10px 0 0 0; font-size: 16px;">IntelliVerse Smart Campus</p>
      </div>
      
      <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName || 'User'}!</h2>
        
        <p style="margin-bottom: 20px; font-size: 16px;">
          We received a request to reset your password for your IntelliVerse account. 
        </p>
        
        <div style="background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Your Password Reset Code:</p>
          <h1 style="font-size: 36px; font-weight: bold; color: #495057; letter-spacing: 8px; margin: 0;">${otpCode}</h1>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #856404;">
            ⚠️ <strong>Security Notice:</strong> This code will expire in 15 minutes. 
            If you didn't request this password reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>
        
        <p style="margin: 20px 0; font-size: 14px; color: #666;">
          Enter this code in the IntelliVerse app to continue with your password reset.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="font-size: 12px; color: #888; text-align: center; margin: 0;">
          This is an automated message from IntelliVerse Smart Campus System.<br>
          If you have any questions, please contact your system administrator.
        </p>
      </div>
    </body>
    </html>
  `;
};

// Updated sendOTPEmail function to handle all purposes
const sendOTPEmail = async (email, otpCode, purpose, firstName = 'User') => {
  try {
    let subject, htmlContent;
    
    switch (purpose) {
      case 'signup':
        subject = '🎓 Welcome to IntelliVerse - Verify Your Account';
        htmlContent = getSignupEmailTemplate(otpCode, firstName);
        break;
      case 'login':
        subject = '🔐 IntelliVerse Login Verification';
        htmlContent = getLoginEmailTemplate(otpCode, firstName);
        break;
      case 'forgot-password':
        subject = '🔑 Reset Your IntelliVerse Password';
        htmlContent = getForgotPasswordEmailTemplate(otpCode, firstName);
        break;
      default:
        // Fallback to your existing template
        subject = purpose === 'signup' ? 
          'Welcome to IntelliVerse - Verify Your Account' : 
          'IntelliVerse Login Verification';
        htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>IntelliVerse OTP</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
              .otp-box { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
              .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 4px; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎓 IntelliVerse</h1>
                <p>Smart Campus Companion</p>
              </div>
              <div class="content">
                <h2>Hello ${firstName}!</h2>
                <p>Your verification code for ${purpose === 'signup' ? 'account registration' : 'login'} is:</p>
                
                <div class="otp-box">
                  <div class="otp-code">${otpCode}</div>
                </div>
                
                <p><strong>Important:</strong></p>
                <ul>
                  <li>This code will expire in 15 minutes</li>
                  <li>Don't share this code with anyone</li>
                  <li>If you didn't request this, please ignore this email</li>
                </ul>
                
                <p>Welcome to the future of campus life! 🚀</p>
              </div>
              <div class="footer">
                <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
                <p>This is an automated message, please do not reply.</p>
              </div>
            </div>
          </body>
          </html>
        `;
    }
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: htmlContent
    };
    
    await transporter.sendMail(mailOptions);
    
    console.log(`✅ ${purpose} email sent successfully to: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Email sending failed for ${purpose}:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

module.exports = {
  sendOTPEmail,
  verifyEmailConfig,
  getForgotPasswordEmailTemplate,
  getSignupEmailTemplate,
  getLoginEmailTemplate
};