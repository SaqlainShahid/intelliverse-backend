const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const RefreshToken = require('../models/RefreshToken');
const { generateOTP, generateOTPExpiry } = require('../utils/otpGenerator');
const { sendOTPEmail } = require('../utils/emailService');
const { generateTokens, getTokenExpiry } = require('../utils/jwtUtils');

// Send Signup OTP
const sendSignupOTP = async (req, res) => {
  try {
    const { email, role, profile } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = generateOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES));
    
    // Save or update OTP
    await OtpVerification.findOneAndUpdate(
      { email, purpose: 'signup' },
      { 
        otpCode, 
        expiresAt, 
        isUsed: false, 
        attempts: 0 
      },
      { upsert: true, new: true }
    );
    
    // Send OTP email
    const emailResult = await sendOTPEmail(email, otpCode, 'signup', profile.firstName);
    
    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email',
      data: {
        email,
        expiresIn: process.env.OTP_EXPIRY_MINUTES + ' minutes'
      }
    });
    
  } catch (error) {
    console.error('Send Signup OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.'
    });
  }
};

// Verify Signup OTP and Create Account
const verifySignupOTP = async (req, res) => {
  try {
    const { email, otpCode, password, role, profile } = req.body;
    
    // Find OTP record
    const otpRecord = await OtpVerification.findOne({
      email,
      purpose: 'signup',
      isUsed: false
    });
    
    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or already used. Please request a new OTP.'
      });
    }
    
    // Check if OTP is expired
    if (otpRecord.expiresAt < new Date()) {
      await OtpVerification.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }
    
    // Check OTP code
    if (otpRecord.otpCode !== otpCode) {
      // Increment attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      if (otpRecord.attempts >= parseInt(process.env.MAX_OTP_ATTEMPTS)) {
        await OtpVerification.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${parseInt(process.env.MAX_OTP_ATTEMPTS) - otpRecord.attempts} attempts remaining.`
      });
    }
    
    // Create user account
    const user = new User({
      email,
      password,
      role,
      profile,
      isVerified: true
    });
    
    await user.save();
    
    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();
    
    console.log(`✅ New user registered: ${email} (${role})`);
    
    res.status(201).json({
      success: true,
      message: 'Account created successfully! You can now login.',
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile
        }
      }
    });
    
  } catch (error) {
    console.error('Verify Signup OTP Error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Account creation failed. Please try again.'
    });
  }
};

// Send Login OTP
const sendLoginOTP = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user and verify password
    const user = await User.findOne({ email, isActive: true });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    if (!user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Account not verified. Please complete signup process.'
      });
    }
    
    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = generateOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES));
    
    // Save OTP
    await OtpVerification.findOneAndUpdate(
      { email, purpose: 'login' },
      { 
        otpCode, 
        expiresAt, 
        isUsed: false, 
        attempts: 0 
      },
      { upsert: true, new: true }
    );
    
    // Send OTP email
    const emailResult = await sendOTPEmail(email, otpCode, 'login', user.profile.firstName);
    
    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email',
      data: {
        email,
        expiresIn: process.env.OTP_EXPIRY_MINUTES + ' minutes'
      }
    });
    
  } catch (error) {
    console.error('Send Login OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.'
    });
  }
};

// Verify Login OTP and Login
const verifyLoginOTP = async (req, res) => {
  try {
    const { email, otpCode, deviceInfo = {} } = req.body;
    
    // Find OTP record
    const otpRecord = await OtpVerification.findOne({
      email,
      purpose: 'login',
      isUsed: false
    });
    
    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or already used. Please request a new OTP.'
      });
    }
    
    // Check if OTP is expired
    if (otpRecord.expiresAt < new Date()) {
      await OtpVerification.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }
    
    // Check OTP code
    if (otpRecord.otpCode !== otpCode) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      if (otpRecord.attempts >= parseInt(process.env.MAX_OTP_ATTEMPTS)) {
        await OtpVerification.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${parseInt(process.env.MAX_OTP_ATTEMPTS) - otpRecord.attempts} attempts remaining.`
      });
    }
    
    // Find user
    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    
    // Save refresh token to database
    const refreshTokenDoc = new RefreshToken({
      userId: user._id,
      token: refreshToken,
      deviceInfo,
      expiresAt: getTokenExpiry(process.env.JWT_REFRESH_EXPIRY)
    });
    
    await refreshTokenDoc.save();
    
    // Update user last login
    user.lastLogin = new Date();
    await user.save();
    
    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();
    
    console.log(`✅ User logged in: ${email}`);
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile,
          lastLogin: user.lastLogin
        },
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });
    
  } catch (error) {
    console.error('Verify Login OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

// Refresh Access Token
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    // Find refresh token in database
    const tokenDoc = await RefreshToken.findOne({
      token: refreshToken,
      isActive: true
    }).populate('userId');
    
    if (!tokenDoc || tokenDoc.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
    
    // Generate new access token
    const { accessToken } = generateTokens(tokenDoc.userId._id);
    
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken
      }
    });
    
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(401).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

// Logout
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      // Deactivate refresh token
      await RefreshToken.findOneAndUpdate(
        { token: refreshToken },
        { isActive: false }
      );
    }
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// Get Current User Profile
const getCurrentUser = async (req, res) => {
  try {
    const user = req.user; // From authenticate middleware
    
    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile,
          isVerified: user.isVerified,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        }
      }
    });
    
  } catch (error) {
    console.error('Get Current User Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user profile'
    });
  }
};

module.exports = {
  sendSignupOTP,
  verifySignupOTP,
  sendLoginOTP,
  verifyLoginOTP,
  refreshAccessToken,
  logout,
  getCurrentUser
};