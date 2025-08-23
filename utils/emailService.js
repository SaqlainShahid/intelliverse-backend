const nodemailer = require('nodemailer');

// Create transporter
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

const sendOTPEmail = async (email, otpCode, purpose, firstName = 'User') => {
  const subject = purpose === 'signup' ? 
    'Welcome to IntelliVerse - Verify Your Account' : 
    'IntelliVerse Login Verification';
    
  const html = `
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
            <li>This code will expire in 10 minutes</li>
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

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject,
      html
    });
    
    console.log(`✅ OTP email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Email send error for ${email}:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  verifyEmailConfig,
  sendOTPEmail
};