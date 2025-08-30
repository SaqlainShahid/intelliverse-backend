const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { 
  validateSignupData, 
  validateLoginData, 
  validateOTPData,
  validateEmailData,              // Added for forgot password
  validateForgotPasswordOTPData,  // Added for forgot password OTP verification
  validatePasswordResetData       // Added for password reset
} = require('../middleware/validation');
const { otpRateLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

// Signup Routes
router.post(
  '/signup/send-otp', 
  otpRateLimiter, 
  validateSignupData, 
  authController.sendSignupOTP
);

router.post(
  '/signup/verify-otp', 
  validateOTPData('signup'), 
  authController.verifySignupOTP
);

// Login Routes
router.post(
  '/login/send-otp', 
  otpRateLimiter, 
  validateLoginData, 
  authController.sendLoginOTP
);

router.post(
  '/login/verify-otp', 
  validateOTPData('login'), 
  authController.verifyLoginOTP
);

// Forgot Password Routes
router.post(
  '/forgot-password/send-otp', 
  otpRateLimiter, 
  validateEmailData, 
  authController.sendForgotPasswordOTP
);

router.post(
  '/forgot-password/verify-otp', 
  validateForgotPasswordOTPData, 
  authController.verifyForgotPasswordOTP
);

router.post(
  '/forgot-password/reset', 
  validatePasswordResetData, 
  authController.resetPassword
);

// Token Management
router.post('/refresh-token', authController.refreshAccessToken);
router.post('/logout', authController.logout);

// Protected Routes
router.get('/me', authenticate, authController.getCurrentUser);

// Health Check Route
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Auth service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;