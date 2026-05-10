const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { uploadAttachment } = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

router.use(authenticate);

router.post('/chats', async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ success: false, message: 'recipientId is required' });
    }
    if (recipientId.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot chat with yourself' });
    }
    const recipient = await User.findById(recipientId).lean();
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Recipient not found' });
    }
    const ids = [req.user._id.toString(), recipientId.toString()].sort();
    const membersHash = `${ids[0]}:${ids[1]}`;

    let chat = await Chat.findOne({ membersHash })
      .populate('participants', 'profile.firstName profile.lastName avatar department role')
      .populate('lastMessage')
      .lean();
    if (!chat) {
      const created = await Chat.create({ participants: ids, membersHash });
      chat = await Chat.findById(created._id)
        .populate('participants', 'profile.firstName profile.lastName avatar department role')
        .populate('lastMessage')
        .lean();
    }
    return res.json({ success: true, data: chat });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create or get chat' });
  }
});

router.get('/chats', async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ updatedAt: -1 })
      .populate('participants', 'profile.firstName profile.lastName avatar department role')
      .populate('lastMessage')
      .lean();
    const mapped = chats.map((c) => {
      const last = c.lastMessage ? {
        content: c.lastMessage.content,
        createdAt: c.lastMessage.createdAt,
        status: c.lastMessage.status,
        attachments: c.lastMessage.attachments || []
      } : null;
      if (c.chatType === 'group') {
        return {
          _id: c._id,
          type: 'group',
          group: { name: c.name, description: c.description, memberCount: (c.participants || []).length },
          lastMessage: last,
          updatedAt: c.updatedAt
        };
      } else {
        const other = c.participants.find(p => p._id.toString() !== req.user._id.toString());
        return { _id: c._id, type: 'private', otherUser: other, lastMessage: last, updatedAt: c.updatedAt };
      }
    });
    return res.json({ success: true, data: mapped });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch chats' });
  }
});

router.get('/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chatId' });
    }
    const chat = await Chat.findById(chatId).lean();
    if (!chat || !chat.participants.some(id => id.toString() === req.user._id.toString())) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    const data = {
      _id: chat._id,
      chatType: chat.chatType,
      settings: chat.settings || { announcementOnly: false, roleMentionsEnabled: true },
      pinnedMessageIds: chat.pinnedMessageIds || []
    };
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch chat details' });
  }
});

router.get('/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chatId' });
    }
    const chat = await Chat.findById(chatId).lean();
    if (!chat || !chat.participants.some(id => id.toString() === req.user._id.toString())) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    const limit = parseInt(req.query.limit || '50');
    const messages = await Message.find({ chat: chatId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ success: true, data: messages.reverse() });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

router.get('/chats/:chatId/search', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { q = '', limit = '50' } = req.query;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chatId' });
    }
    const chat = await Chat.findById(chatId).lean();
    if (!chat || !chat.participants.some(id => id.toString() === req.user._id.toString())) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    const query = { chat: chatId };
    if (q && typeof q === 'string') {
      query.$or = [
        { content: { $regex: q, $options: 'i' } },
        { 'attachments.filename': { $regex: q, $options: 'i' } }
      ];
    }
    const items = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();
    return res.json({ success: true, data: items });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
});

router.patch('/chats/:chatId/settings', authorize('admin'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { announcementOnly, roleMentionsEnabled } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chatId' });
    }
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    if (announcementOnly !== undefined) {
      chat.settings = chat.settings || {};
      chat.settings.announcementOnly = !!announcementOnly;
    }
    if (roleMentionsEnabled !== undefined) {
      chat.settings = chat.settings || {};
      chat.settings.roleMentionsEnabled = !!roleMentionsEnabled;
    }
    await chat.save();
    try {
      if (global.io) global.io.to(chat._id.toString()).emit('chat:settings', { chatId: chat._id, settings: chat.settings });
    } catch {}
    return res.json({ success: true, data: { chatId: chat._id, settings: chat.settings } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { search = '', limit = 8 } = req.query;
    const q = {};
    if (search) {
      q.$or = [
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } },
      ];
    }
    q.isActive = true;
    const users = await User.find(q)
      .select('email role profile.firstName profile.lastName profile.department')
      .limit(parseInt(limit))
      .lean();
    const filtered = users.filter(u => u._id.toString() !== req.user._id.toString());
    return res.json({ success: true, data: filtered });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to search users' });
  }
});

router.post('/groups', async (req, res) => {
  try {
    const { name, description, members = [], admins = [], category = null, meta = {} } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }
    const memberIds = Array.from(new Set([req.user._id.toString(), ...members.map(m => m.toString())]));
    const adminIds = Array.from(new Set([req.user._id.toString(), ...admins.map(a => a.toString())]));
    const chat = await Chat.create({
      chatType: 'group',
      name,
      description: description || null,
      admins: adminIds,
      participants: memberIds,
      category: category || null,
      meta: {
        department: meta.department || null,
        batch: meta.batch || null,
        course: meta.course || null
      }
    });
  const populated = await Chat.findById(chat._id)
    .populate('participants', 'profile.firstName profile.lastName email')
    .lean();
    try {
      const payload = {
        _id: chat._id,
        type: 'group',
        group: { name: chat.name, description: chat.description, memberCount: (chat.participants || []).length },
        lastMessage: null,
        updatedAt: chat.updatedAt
      };
      for (const p of (chat.participants || [])) {
        if (global.io) global.io.to(p.toString()).emit('group:created', payload);
        try {
          const pref = await User.findById(p).select('preferences.notificationsEnabled').lean();
          if (pref?.preferences?.notificationsEnabled !== false) {
            const n = await Notification.create({ user: p, type: 'group_added', title: 'Added to group', message: chat.name || 'New group', data: { chatId: chat._id } });
            if (global.io) global.io.to(p.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        } catch {}
      }
    } catch {}
    return res.json({ success: true, data: populated });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create group' });
  }
});

router.get('/groups', authorize('admin'), async (req, res) => {
  try {
    const { category } = req.query;
    const q = { chatType: 'group' };
    if (category && ['department', 'batch', 'course'].includes(category)) {
      q.category = category;
    }
    const groups = await Chat.find(q)
      .sort({ createdAt: -1 })
      .populate('participants', 'email role isActive profile.firstName profile.lastName profile.department')
      .populate('admins', 'email profile.firstName profile.lastName')
      .lean();
    const mapped = groups.map(g => ({
      _id: g._id,
      name: g.name,
      description: g.description,
      category: g.category,
      meta: g.meta,
      createdAt: g.createdAt,
      memberCount: (g.participants || []).length,
      admins: (g.admins || []).map(a => ({ _id: a._id, name: `${a.profile?.firstName || ''} ${a.profile?.lastName || ''}`.trim(), email: a.email })),
      members: (g.participants || []).map(p => ({
        _id: p._id,
        name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
        email: p.email,
        role: p.role,
        department: p.profile?.department,
        isActive: p.isActive,
      })),
    }));
    return res.json({ success: true, data: mapped });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load groups' });
  }
});

router.post('/groups/auto-create', authorize('admin'), async (req, res) => {
  try {
    const { type, key, name, description, admins = [] } = req.body;
    if (!type || !['department', 'batch', 'course'].includes(String(type))) {
      return res.status(400).json({ success: false, message: 'type must be one of department|batch|course' });
    }

    let members = [];
    if (type === 'department') {
      if (!key) return res.status(400).json({ success: false, message: 'department key is required' });
      members = await User.find({ 'profile.department': key, isActive: true })
        .select('_id')
        .lean();
      members = members.map(u => u._id.toString());
    } else if (type === 'batch') {
      if (key === undefined || key === null) return res.status(400).json({ success: false, message: 'batch key (semester) is required' });
      const semester = Number(key);
      if (Number.isNaN(semester)) return res.status(400).json({ success: false, message: 'batch key must be a number (semester)' });
      members = await User.find({ 'profile.semester': semester, isActive: true })
        .select('_id')
        .lean();
      members = members.map(u => u._id.toString());
    } else if (type === 'course') {
      const emails = Array.isArray(req.body.memberEmails) ? req.body.memberEmails.filter(Boolean) : [];
      if (emails.length) {
        const found = await User.find({ email: { $in: emails }, isActive: true })
          .select('_id')
          .lean();
        members = found.map(u => u._id.toString());
      } else if (Array.isArray(req.body.members) && req.body.members.length > 0) {
        members = req.body.members.map(id => id.toString());
      } else {
        return res.status(400).json({ success: false, message: 'course groups require memberEmails[] or members[]' });
      }
    }

    // Ensure creator is included and dedupe
    const memberIds = Array.from(new Set([req.user._id.toString(), ...members]));
    const adminIds = Array.from(new Set([req.user._id.toString(), ...admins.map(a => a.toString())]));

    // Idempotence: check existing by category/meta
    const match = { chatType: 'group', category: type };
    if (type === 'department') match['meta.department'] = key;
    if (type === 'batch') match['meta.batch'] = String(key);
    if (type === 'course') match['meta.course'] = key || null;

    let chat = await Chat.findOne(match).lean();
    if (chat) {
      // Merge members/admins if rerun
      await Chat.updateOne({ _id: chat._id }, {
        $addToSet: {
          participants: { $each: memberIds },
          admins: { $each: adminIds }
        },
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
      });
      const populated = await Chat.findById(chat._id)
        .populate('participants', 'profile.firstName profile.lastName email')
        .lean();
      return res.json({ success: true, data: populated, updated: true });
    }

    // Create new group
    chat = await Chat.create({
      chatType: 'group',
      name: name || (type === 'department' ? `Department: ${key}` : type === 'batch' ? `Batch: ${key}` : `Course Group`),
      description: description || null,
      admins: adminIds,
      participants: memberIds,
      category: type,
      meta: {
        department: type === 'department' ? key : null,
        batch: type === 'batch' ? String(key) : null,
        course: type === 'course' ? (key || null) : null
      }
    });
    const populated = await Chat.findById(chat._id)
      .populate('participants', 'profile.firstName profile.lastName email')
      .lean();
    try {
      const payload = {
        _id: chat._id,
        type: 'group',
        group: { name: chat.name, description: chat.description, memberCount: (chat.participants || []).length },
        lastMessage: null,
        updatedAt: chat.updatedAt
      };
      for (const p of (chat.participants || [])) {
        if (global.io) global.io.to(p.toString()).emit('group:created', payload);
      }
    } catch {}
    return res.json({ success: true, data: populated, created: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to auto-create group' });
  }
});
router.get('/groups/meta', authorize('admin'), async (req, res) => {
  try {
    const departments = await User.distinct('profile.department', { isActive: true, 'profile.department': { $exists: true, $ne: null } });
    const batchesRaw = await User.distinct('profile.semester', { isActive: true, 'profile.semester': { $exists: true } });
    const batches = (batchesRaw || []).filter((v) => typeof v === 'number' || typeof v === 'string').map((v) => String(v)).filter(Boolean);
    return res.json({ success: true, data: { departments, batches } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load group meta' });
  }
});

router.get('/peers', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const dept = req.user?.profile?.department;
    if (!dept) return res.json({ success: true, data: [] });
    const users = await User.find({ 'profile.department': dept, isActive: true })
      .select('email role profile.firstName profile.lastName profile.department')
      .limit(parseInt(limit))
      .lean();
    const filtered = users.filter(u => u._id.toString() !== req.user._id.toString());
    return res.json({ success: true, data: filtered });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load peers' });
  }
});

router.get('/top', async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit || '10');
    const windowDays = parseInt(req.query.windowDays || '7');
    const sortMode = (req.query.sort || 'time').toLowerCase();

    const match = { $or: [ { sender: userId }, { recipient: userId } ] };
    if (!isNaN(windowDays) && windowDays > 0) {
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      match.createdAt = { $gte: since };
    }

    const pipeline = [
      { $match: match },
      { $group: { _id: '$chat', count: { $sum: 1 }, lastMessageAt: { $max: '$createdAt' } } },
      { $limit: limit },
    ];

    if (sortMode === 'count') {
      pipeline.splice(2, 0, { $sort: { count: -1, lastMessageAt: -1 } });
    } else {
      pipeline.splice(2, 0, { $sort: { lastMessageAt: -1, count: -1 } });
    }

    const groups = await Message.aggregate(pipeline);
    const results = [];
    for (const g of groups) {
      const chat = await Chat.findById(g._id)
        .populate('participants', 'profile.firstName profile.lastName email')
        .lean();
      if (!chat) continue;
      const other = (chat.participants || []).find(p => p._id.toString() !== userId.toString());
      if (!other) continue;
      results.push({ chatId: chat._id, otherUser: other, messageCount: g.count, lastMessageAt: g.lastMessageAt });
    }
    return res.json({ success: true, data: results });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load top interactions' });
  }
});

router.post('/media', async (req, res, next) => {
  uploadAttachment.single('file')(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    try {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ success: false, message: 'Cloudinary not configured' });
      }
      if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
      const resource_type = 'auto';
      const folder = process.env.CLOUDINARY_FOLDER || 'intelliverse/chat';
      const result = await cloudinary.uploader.upload(req.file.path, { resource_type, folder });
      const mime = req.file.mimetype || '';
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'pdf' : 'file';
      const payload = {
        url: result.secure_url,
        publicId: result.public_id,
        mimeType: mime,
        bytes: req.file.size,
        filename: req.file.originalname,
        kind
      };
      return res.json({ success: true, data: payload });
    } catch (e) {
      console.error('Cloudinary upload error:', e?.message || e);
      return res.status(500).json({ success: false, message: 'Cloud upload failed' });
    }
  });
});

module.exports = router;
