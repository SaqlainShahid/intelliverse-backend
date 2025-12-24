const Club = require('../models/Club');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} catch (e) {}

const getClubs = async (req, res) => {
  try {
    const { category, search, limit = 20, page = 1 } = req.query;
    const query = {};
    if (category && category !== 'all') query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'faculty');
    if (!isAdmin) {
      if (req.user) {
        query.$or = [ { approvalStatus: 'APPROVED' }, { createdBy: req.user._id } ];
      } else {
        query.approvalStatus = 'APPROVED';
      }
    }
    const clubs = await Club.find(query)
      .populate('president', 'profile.firstName profile.lastName role')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Club.countDocuments(query);

    res.status(200).json({ success: true, data: clubs, pagination: { total, page: parseInt(page) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id)
      .populate('president', 'profile.firstName profile.lastName role')
      .populate('members.user', 'profile.firstName profile.lastName role')
      .populate('events', 'title date category attendees');
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    res.status(200).json({ success: true, data: club });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createClub = async (req, res) => {
  try {
    const payload = { ...req.body, president: req.user._id, createdBy: req.user._id };

    // Basic validation
    if (!payload.name || !payload.name.trim()) {
      return res.status(400).json({ success: false, message: 'Club name is required' });
    }
    if (!payload.description || !payload.description.trim()) {
      return res.status(400).json({ success: false, message: 'Club description is required' });
    }
    if (!payload.category || !payload.category.trim()) {
      return res.status(400).json({ success: false, message: 'Club category is required' });
    }
    if (!payload.founded || !/^\d{4}$/.test(String(payload.founded))) {
      return res.status(400).json({ success: false, message: 'Valid founding year (YYYY) is required' });
    }
    if (typeof payload.tags === 'string') {
      payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    const approvalStatus = (req.user.role === 'admin' || req.user.role === 'faculty') ? 'APPROVED' : 'PENDING_APPROVAL';
    payload.approvalStatus = approvalStatus;
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: 'intelliverse/clubs', resource_type: 'image' });
        payload.imageUrl = result.secure_url;
        payload.imagePublicId = result.public_id;
      } finally {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
    }
    const club = await Club.create(payload);
    res.status(201).json({ success: true, message: 'Club created', data: club });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern && error.keyPattern.name) {
      return res.status(409).json({ success: false, message: 'A club with this name already exists' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    const canUpdate = club.president.toString() === req.user._id.toString() || req.user.role === 'admin';
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Not authorized' });
    const updateData = { ...req.body };
    if (typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: 'intelliverse/clubs', resource_type: 'image' });
        updateData.imageUrl = result.secure_url;
        updateData.imagePublicId = result.public_id;
        if (club.imagePublicId) {
          try { await cloudinary.uploader.destroy(club.imagePublicId); } catch (e) {}
        }
      } finally {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
    }
    const updated = await Club.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    res.status(200).json({ success: true, message: 'Club updated', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Not authorized' });
    await Club.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Club deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const joinClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    if (club.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Club not approved' });
    }
    const added = club.addMember(req.user._id, 'member');
    if (!added) return res.status(400).json({ success: false, message: 'Already a member' });
    await club.save();
    res.status(200).json({ success: true, message: 'Joined club' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const leaveClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    club.removeMember(req.user._id);
    await club.save();
    res.status(200).json({ success: true, message: 'Left club' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const crypto = require('crypto');
const generateClubQr = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    const canManage = club.president.toString() === req.user._id.toString() || req.user.role === 'admin';
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    club.qrCode = crypto.randomBytes(16).toString('hex');
    club.qrCodeGeneratedAt = new Date();
    await club.save();
    res.status(200).json({ success: true, data: { qrCode: club.qrCode } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const resolveClubByCode = async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ success: false, message: 'code is required' });
    const club = await Club.findOne({ qrCode: code });
    if (!club) return res.status(404).json({ success: false, message: 'Not found' });
    res.status(200).json({ success: true, data: club });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const Notification = require('../models/Notification');
const announceClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    const canAnnounce = club.president.toString() === req.user._id.toString() || req.user.role === 'admin';
    if (!canAnnounce) return res.status(403).json({ success: false, message: 'Not authorized' });
    const title = String(req.body.title || '').trim() || 'Club Announcement';
    const message = String(req.body.message || '').trim() || '';
    let sent = 0;
    for (const m of club.members) {
      try {
        await Notification.create({
          user: m.user,
          type: 'club_announcement',
          title,
          message,
          data: { clubId: club._id }
        });
        sent += 1;
      } catch (e) {}
    }
    res.status(200).json({ success: true, data: { sent } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { getClubs, getClub, createClub, updateClub, deleteClub, joinClub, leaveClub, generateClubQr, resolveClubByCode, announceClub };
const approveClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    club.approvalStatus = 'APPROVED';
    club.approvedBy = req.user._id;
    club.approvedAt = new Date();
    club.rejectionReason = null;
    await club.save();
    return res.json({ success: true, message: 'Club approved' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const rejectClub = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ success: false, message: 'Club not found' });
    const reason = String(req.body.reason || '').trim() || null;
    club.approvalStatus = 'REJECTED';
    club.approvedBy = null;
    club.approvedAt = null;
    club.rejectionReason = reason;
    await club.save();
    return res.json({ success: true, message: 'Club rejected' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.approveClub = approveClub;
module.exports.rejectClub = rejectClub;
