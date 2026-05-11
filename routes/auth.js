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
const { authenticate, authorize } = require('../middleware/auth');

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

// Admin/Faculty utilities
router.get('/admin/users', authenticate, (req, res, next) => {
  if (!['admin', 'faculty', 'hod'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  next();
}, authController.getAdminUsers);

router.get('/admin/stats', authenticate, (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  next();
}, authController.getAdminStats);

// Update faculty designation (admin only)
router.put('/admin/users/:userId/designation', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  try {
    const { designation } = req.body;
    if (typeof designation !== 'string') {
      return res.status(400).json({ success: false, message: 'designation must be a string' });
    }
    const User = require('../models/User');
    const updated = await User.findByIdAndUpdate(
      req.params.userId,
      { 'profile.designation': designation.trim() },
      { new: true }
    ).select('profile.firstName profile.lastName profile.designation');
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Health Check Route
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Auth service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
