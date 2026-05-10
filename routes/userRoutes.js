const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const { generateOTP, generateOTPExpiry } = require('../utils/otpGenerator');
const { sendOTPEmail } = require('../utils/emailService');
const { upload } = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

router.use(authenticate);

// Get user statistics
router.get('/stats', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    // Return basic stats based on role
    const stats = {
      role: user.role,
      department: user.profile.department,
      // Add more stats as needed
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
});

// Upload avatar
router.post('/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'intelliverse/avatars',
      width: 300,
      height: 300,
      crop: 'fill',
      gravity: 'faces'
    });

    // Clean up local file
    try {
      fs.unlinkSync(req.file.path);
    } catch (err) {
      console.warn('Failed to delete local file:', err);
    }

    res.json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    // Try to clean up file if it exists
    if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ success: false, message: 'Failed to upload avatar' });
  }
});

// Get current user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, data: { user } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

// Update user profile and settings
router.put('/profile', async (req, res) => {
  try {
    const {
      firstName, lastName, displayName, phone, avatar,
      department, campus,
      // Student specific
      studentId, semester, cgpa,
      // Faculty specific
      employeeId, designation, officeRoom,
      // Preferences
      notificationsEnabled,
      emailNotifications,
      darkMode,
      twoFactorEnabled,
      // Privacy
      canMessage,
      profileVisibility
    } = req.body;

    const update = {};
    
    // Helper to add to update object if defined
    const addIfDefined = (key, value) => {
      if (value !== undefined) update[key] = value;
    };

    // Profile fields
    addIfDefined('profile.firstName', firstName);
    addIfDefined('profile.lastName', lastName);
    addIfDefined('profile.displayName', displayName);
    addIfDefined('profile.phone', phone);
    addIfDefined('profile.avatar', avatar);
    addIfDefined('profile.department', department);
    addIfDefined('profile.campus', campus);

    // Role specific fields
    if (req.user.role === 'student') {
      addIfDefined('profile.studentId', studentId);
      addIfDefined('profile.semester', semester);
      addIfDefined('profile.cgpa', cgpa);
    } else if (req.user.role === 'faculty') {
      addIfDefined('profile.employeeId', employeeId);
      addIfDefined('profile.designation', designation);
      addIfDefined('profile.officeRoom', officeRoom);
    }

    // Preferences
    addIfDefined('preferences.notificationsEnabled', notificationsEnabled);
    addIfDefined('preferences.emailNotifications',   emailNotifications);
    addIfDefined('preferences.darkMode',             darkMode);
    addIfDefined('preferences.twoFactorEnabled',     twoFactorEnabled);

    // Privacy
    addIfDefined('privacy.canMessage', canMessage);
    addIfDefined('privacy.profileVisibility', profileVisibility);

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({ success: true, data: { user } });  // includes preferences & privacy
  } catch (e) {
    console.error('Profile update error:', e);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// Legacy route support (redirects logic to new structure if needed, but keeping for compatibility)
router.put('/settings', async (req, res) => {
  // Reuse the logic or just keep it simple as it was
  try {
    const { displayName, avatar, notificationsEnabled } = req.body || {};
    const update = {};
    if (typeof displayName === 'string') update['profile.displayName'] = displayName.trim() || null;
    if (typeof avatar === 'string') update['profile.avatar'] = avatar;
    if (typeof notificationsEnabled === 'boolean') update['preferences.notificationsEnabled'] = notificationsEnabled;
    
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
    res.json({ success: true, data: { user } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

// ShadowMute: Mute a user
router.post('/mute', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    // Prevent muting yourself
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot mute yourself' });
    }

    // Add to mutedUsers set (avoid duplicates)
    await User.findByIdAndUpdate(req.user._id, { 
      $addToSet: { mutedUsers: userId } 
    });

    res.json({ success: true, message: 'User muted successfully' });
  } catch (error) {
    console.error('Mute error:', error);
    res.status(500).json({ success: false, message: 'Failed to mute user' });
  }
});

// ShadowMute: Unmute a user
router.post('/unmute', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    // Remove from mutedUsers
    await User.findByIdAndUpdate(req.user._id, { 
      $pull: { mutedUsers: userId } 
    });

    res.json({ success: true, message: 'User unmuted successfully' });
  } catch (error) {
    console.error('Unmute error:', error);
    res.status(500).json({ success: false, message: 'Failed to unmute user' });
  }
});

// ShadowMute: Get list of muted users
router.get('/mute', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('mutedUsers').populate('mutedUsers', 'profile.firstName profile.lastName profile.avatar');
    res.json({ success: true, data: user.mutedUsers || [] });
  } catch (error) {
    console.error('Get muted users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch muted users' });
  }
});

// Public profile
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    const target = await User.findById(id).select('-password');
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    const viewer = await User.findById(req.user._id).select('profile.role profile.department');
    const visibility = target.privacy?.profileVisibility || 'everyone';
    const sameDept = viewer?.profile?.department && target?.profile?.department && viewer.profile.department === target.profile.department;
    const isFaculty = viewer?.role === 'faculty' || viewer?.role === 'admin';
    let allowed = true;
    if (visibility === 'private' && req.user._id.toString() !== target._id.toString()) allowed = false;
    if (visibility === 'department' && !sameDept && req.user._id.toString() !== target._id.toString()) allowed = false;
    if (visibility === 'faculty_only' && !isFaculty && req.user._id.toString() !== target._id.toString()) allowed = false;
    if (!allowed) {
      const minimal = {
        _id: target._id,
        email: target.email,
        role: target.role,
        profile: { firstName: target.profile?.firstName, lastName: target.profile?.lastName, avatar: target.profile?.avatar, department: target.profile?.department }
      };
      return res.json({ success: true, data: { user: minimal, restricted: true } });
    }
    return res.json({ success: true, data: { user: target, restricted: false } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
});

// Archive: Archive a chat
router.post('/archive', async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, message: 'chatId is required' });
    }

    await User.findByIdAndUpdate(req.user._id, { 
      $addToSet: { archivedChats: chatId } 
    });

    res.json({ success: true, message: 'Chat archived successfully' });
  } catch (error) {
    console.error('Archive error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive chat' });
  }
});

// Archive: Unarchive a chat
router.post('/unarchive', async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, message: 'chatId is required' });
    }

    await User.findByIdAndUpdate(req.user._id, { 
      $pull: { archivedChats: chatId } 
    });

    res.json({ success: true, message: 'Chat unarchived successfully' });
  } catch (error) {
    console.error('Unarchive error:', error);
    res.status(500).json({ success: false, message: 'Failed to unarchive chat' });
  }
});

// Archive: Get archived chats
router.get('/archived', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('archivedChats');
    res.json({ success: true, data: user.archivedChats || [] });
  } catch (error) {
    console.error('Get archived error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch archived chats' });
  }
});

// ── 2FA Toggle: send verification OTP ──────────────────────────────────────
router.post('/2fa/send-otp', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otpCode  = generateOTP();
    const expiresAt = generateOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES) || 10);

    await OtpVerification.findOneAndUpdate(
      { email: user.email, purpose: 'toggle-2fa' },
      { otpCode, expiresAt, isUsed: false, attempts: 0 },
      { upsert: true, new: true }
    );

    const emailResult = await sendOTPEmail(user.email, otpCode, 'login', user.profile.firstName);
    if (!emailResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to send verification code' });
    }

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('2FA send-otp error:', err);
    res.status(500).json({ success: false, message: 'Failed to send code' });
  }
});

// ── 2FA Toggle: verify OTP and apply the change ────────────────────────────
router.post('/2fa/toggle', async (req, res) => {
  try {
    const { otpCode, enable } = req.body;
    if (typeof enable !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enable (boolean) is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otpRecord = await OtpVerification.findOne({
      email: user.email, purpose: 'toggle-2fa', isUsed: false
    });

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Code not found. Please request a new one.' });
    }
    if (otpRecord.expiresAt < new Date()) {
      await OtpVerification.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
    }
    if (otpRecord.otpCode !== otpCode) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const maxAttempts = parseInt(process.env.MAX_OTP_ATTEMPTS) || 5;
      if (otpRecord.attempts >= maxAttempts) {
        await OtpVerification.deleteOne({ _id: otpRecord._id });
        return res.status(400).json({ success: false, message: 'Too many failed attempts. Please request a new code.' });
      }
      return res.status(400).json({
        success: false,
        message: `Invalid code. ${maxAttempts - otpRecord.attempts} attempts remaining.`
      });
    }

    // OTP valid — apply the toggle
    await User.findByIdAndUpdate(req.user._id, {
      $set: { 'preferences.twoFactorEnabled': enable }
    });

    otpRecord.isUsed = true;
    await otpRecord.save();

    console.log(`🔐 2FA ${enable ? 'enabled' : 'disabled'} for: ${user.email}`);

    res.json({
      success: true,
      message: `Two-factor authentication ${enable ? 'enabled' : 'disabled'} successfully`,
      data: { twoFactorEnabled: enable }
    });
  } catch (err) {
    console.error('2FA toggle error:', err);
    res.status(500).json({ success: false, message: 'Failed to update 2FA setting' });
  }
});

module.exports = router;
