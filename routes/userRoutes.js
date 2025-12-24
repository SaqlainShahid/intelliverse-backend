const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');
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
      // Settings
      notificationsEnabled,
      emailNotifications,
      darkMode,
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
    addIfDefined('preferences.emailNotifications', emailNotifications);
    addIfDefined('preferences.darkMode', darkMode);
    addIfDefined('preferences.twoFactor', req.body.twoFactor);

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

    res.json({ success: true, data: { user } });
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

module.exports = router;
