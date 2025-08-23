const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { 
  validateSignupData, 
  validateLoginData, 
  validateOTPData 
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
  validateOTPData, 
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
  validateOTPData, 
  authController.verifyLoginOTP
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