const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const CollabRequest = require('../models/CollabRequest');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

const POPULATE_USER = 'email profile.firstName profile.lastName profile.department profile.designation role expertise';

router.use(authenticate);

// POST /api/collab/requests — faculty/hod creates a collaboration request
router.post('/requests', authorize('faculty', 'hod', 'admin'), async (req, res) => {
  try {
    const { title, description, topic, targetDepartments = [], targetRoles = ['faculty'] } = req.body;
    if (!title?.trim() || !description?.trim()) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }
    const request = await CollabRequest.create({
      requestedBy: req.user._id,
      title: title.trim(),
      description: description.trim(),
      topic: topic?.trim() || null,
      targetDepartments,
      targetRoles,
    });
    const populated = await CollabRequest.findById(request._id).populate('requestedBy', POPULATE_USER).lean();

    // Notify relevant faculty via socket
    if (global.io) {
      const roleFilter = targetRoles.length ? { role: { $in: targetRoles } } : {};
      const deptFilter = targetDepartments.length ? { 'profile.department': { $in: targetDepartments } } : {};
      const targets = await User.find({ isActive: true, _id: { $ne: req.user._id }, ...roleFilter, ...deptFilter }).select('_id').lean();
      targets.forEach(u => global.io.to(u._id.toString()).emit('collab:new', { request: populated }));
    }

    return res.status(201).json({ success: true, data: populated });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create collaboration request' });
  }
});

// GET /api/collab/requests — list requests visible to this user
router.get('/requests', async (req, res) => {
  try {
    const { status = 'open', mine } = req.query;
    const filter = {};
    if (status !== 'all') filter.status = status;

    if (mine === 'true') {
      // "My Requests" — show only what this user created
      filter.requestedBy = req.user._id;
    } else {
      // "Open Requests" — show requests targeted at this user's role
      // (empty targetRoles = open to everyone; own requests always visible)
      filter.$or = [
        { targetRoles: { $size: 0 } },
        { targetRoles: req.user.role },
      ];
    }

    const requests = await CollabRequest.find(filter)
      .populate('requestedBy', POPULATE_USER)
      .populate('respondents.user', POPULATE_USER)
      .sort({ createdAt: -1 })
      .lean();

    // Normalise respondents whose status was stored before the field was added
    requests.forEach(r => r.respondents?.forEach(resp => {
      if (!resp.status) resp.status = 'pending';
    }));

    return res.json({ success: true, data: requests });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load collaboration requests' });
  }
});

// POST /api/collab/requests/:id/respond — express interest
router.post('/requests/:id/respond', async (req, res) => {
  try {
    const { message = '' } = req.body;
    const cr = await CollabRequest.findById(req.params.id);
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.status !== 'open') return res.status(400).json({ success: false, message: 'This request is closed' });
    if (cr.requestedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot respond to your own request' });
    }
    const alreadyResponded = cr.respondents.some(r => r.user.toString() === req.user._id.toString());
    if (alreadyResponded) return res.status(400).json({ success: false, message: 'Already responded' });

    cr.respondents.push({ user: req.user._id, message: message.trim(), respondedAt: new Date() });
    await cr.save();

    if (global.io) {
      global.io.to(cr.requestedBy.toString()).emit('collab:response', { requestId: cr._id, responderId: req.user._id });
    }

    return res.json({ success: true, data: { respondentCount: cr.respondents.length } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to respond' });
  }
});

// PATCH /api/collab/requests/:id/respondents/:respondentId/accept
router.patch('/requests/:id/respondents/:respondentId/accept', async (req, res) => {
  try {
    const cr = await CollabRequest.findById(req.params.id);
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the request owner can accept members' });
    }
    const respondent = cr.respondents.id(req.params.respondentId);
    if (!respondent) return res.status(404).json({ success: false, message: 'Respondent not found' });

    respondent.status = 'accepted';
    await cr.save();

    // Notify the accepted user
    if (global.io) {
      global.io.to(respondent.user.toString()).emit('collab:accepted', {
        requestId: cr._id,
        title: cr.title,
      });
    }

    return res.json({ success: true, data: { respondentId: respondent._id, status: 'accepted' } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to accept member' });
  }
});

// PATCH /api/collab/requests/:id/respondents/:respondentId/decline
router.patch('/requests/:id/respondents/:respondentId/decline', async (req, res) => {
  try {
    const cr = await CollabRequest.findById(req.params.id);
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the request owner can decline members' });
    }
    const respondent = cr.respondents.id(req.params.respondentId);
    if (!respondent) return res.status(404).json({ success: false, message: 'Respondent not found' });

    respondent.status = 'declined';
    await cr.save();

    if (global.io) {
      global.io.to(respondent.user.toString()).emit('collab:declined', {
        requestId: cr._id,
        title: cr.title,
      });
    }

    return res.json({ success: true, data: { respondentId: respondent._id, status: 'declined' } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to decline member' });
  }
});

// POST /api/collab/requests/:id/team-chat — create group chat with all accepted members
router.post('/requests/:id/team-chat', async (req, res) => {
  try {
    const cr = await CollabRequest.findById(req.params.id).populate('requestedBy', '_id');
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.requestedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the request owner can start the team chat' });
    }

    // Return existing team chat if already created
    if (cr.teamChatId) return res.json({ success: true, data: { chatId: cr.teamChatId } });

    const acceptedIds = cr.respondents
      .filter(r => r.status === 'accepted')
      .map(r => r.user.toString());

    if (acceptedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Accept at least one member first' });
    }

    const memberIds = Array.from(new Set([req.user._id.toString(), ...acceptedIds]));
    const chat = await Chat.create({
      chatType: 'group',
      name: cr.title,
      description: `Collaboration team for: ${cr.title}`,
      admins: [req.user._id.toString()],
      participants: memberIds,
      category: 'collaboration',
    });

    // Welcome message
    const msg = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      content: `Welcome to the team! This group was created for the collaboration: "${cr.title}".`,
      type: 'text',
    });
    await Chat.findByIdAndUpdate(chat._id, { lastMessage: msg._id });

    cr.teamChatId = chat._id;
    await cr.save();

    // Notify all members
    if (global.io) {
      memberIds.forEach(uid => {
        global.io.to(uid).emit('group:created', { _id: chat._id, type: 'group', group: { name: chat.name, memberCount: memberIds.length } });
        global.io.to(uid).emit('message:new', { chatId: chat._id, message: msg });
      });
    }

    return res.status(201).json({ success: true, data: { chatId: chat._id } });
  } catch (e) {
    console.error('[team-chat]', e);
    return res.status(500).json({ success: false, message: 'Failed to create team chat' });
  }
});

// PATCH /api/collab/requests/:id/close — creator closes
router.patch('/requests/:id/close', async (req, res) => {
  try {
    const cr = await CollabRequest.findById(req.params.id);
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.requestedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    cr.status = 'closed';
    await cr.save();
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to close request' });
  }
});

// DELETE /api/collab/requests/:id — creator or admin deletes
router.delete('/requests/:id', async (req, res) => {
  try {
    const cr = await CollabRequest.findById(req.params.id);
    if (!cr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (cr.requestedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await cr.deleteOne();
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete request' });
  }
});

module.exports = router;
