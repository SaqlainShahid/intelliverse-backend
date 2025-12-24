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

// ShadowMute: list muted users
router.get('/mute', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('privacy.shadowMuted').populate('privacy.shadowMuted.user', 'email profile.firstName profile.lastName').lean();
    const muted = (user?.privacy?.shadowMuted || []).map(entry => {
      const u = entry.user || entry;
      return { _id: u._id || u, name: `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim(), email: u.email, since: entry.since || null };
    });
    return res.json({ success: true, data: muted });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load muted users' });
  }
});

// ShadowMute: mute a user
router.post('/mute/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }
    if (userId.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot mute yourself' });
    }
    const target = await User.findById(userId).select('_id').lean();
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Ensure single entry with since timestamp
    await User.updateOne({ _id: req.user._id }, { $pull: { 'privacy.shadowMuted': { user: userId } } });
    await User.updateOne({ _id: req.user._id }, { $pull: { 'privacy.shadowMuted': userId } });
    await User.updateOne({ _id: req.user._id }, { $push: { 'privacy.shadowMuted': { user: userId, since: new Date() } } });
    return res.json({ success: true, data: { mutedUserId: userId } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to mute user' });
  }
});

// ShadowMute: unmute a user
router.delete('/mute/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }
    await User.updateOne({ _id: req.user._id }, { $pull: { 'privacy.shadowMuted': { user: userId } } });
    await User.updateOne({ _id: req.user._id }, { $pull: { 'privacy.shadowMuted': userId } });
    return res.json({ success: true, data: { unmutedUserId: userId } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to unmute user' });
  }
});

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
      .populate('participants', 'profile.firstName profile.lastName profile.avatar profile.department role')
      .populate('lastMessage')
      .lean();
    if (!chat) {
      const created = await Chat.create({ participants: ids, membersHash });
      chat = await Chat.findById(created._id)
        .populate('participants', 'profile.firstName profile.lastName profile.avatar profile.department role')
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
    // Get deleted chats to exclude
    const user = await User.findById(req.user._id).select('deletedChats').lean();
    const deletedIds = user?.deletedChats || [];

    const chats = await Chat.find({ 
        participants: req.user._id,
        _id: { $nin: deletedIds }
    })
      .sort({ updatedAt: -1 })
      .populate('participants', 'profile.firstName profile.lastName profile.avatar profile.department role')
      .populate('lastMessage')
      .lean();

    const mapped = await Promise.all(chats.map(async (c) => {
      let last = c.lastMessage;
      
      // Shadow Mute Filter
      if (last) {
        const isSender = last.sender && last.sender.toString() === req.user._id.toString();
        if (!isSender) {
            // Check visibility for 1:1
            if (c.chatType !== 'group' && last.visibleToReceiver === false) {
                last = null;
            }
            // Check hiddenFor for group
            if (last && last.hiddenFor && last.hiddenFor.some(id => id.toString() === req.user._id.toString())) {
                last = null;
            }
        }
      }

      const lastMsgData = last ? {
        content: last.content,
        createdAt: last.createdAt,
        status: last.status,
        attachments: last.attachments || [],
        sender: last.sender
      } : null;

      let unreadCount = 0;
      if (c.chatType === 'group') {
        unreadCount = await Message.countDocuments({
          chat: c._id,
          recipient: { $eq: null },
          sender: { $ne: req.user._id },
          hiddenFor: { $ne: req.user._id },
          $nor: [{ receipts: { $elemMatch: { user: req.user._id, status: 'read' } } }]
        });
        return {
          _id: c._id,
          type: 'group',
          group: { name: c.name, description: c.description, memberCount: (c.participants || []).length },
          lastMessage: lastMsgData,
          updatedAt: c.updatedAt,
          unreadCount
        };
      } else {
        const other = c.participants.find(p => p._id.toString() !== req.user._id.toString());
        unreadCount = await Message.countDocuments({ chat: c._id, recipient: req.user._id, status: { $ne: 'seen' }, visibleToReceiver: true });
        return { _id: c._id, type: 'private', otherUser: other, lastMessage: lastMsgData, updatedAt: c.updatedAt, unreadCount };
      }
    }));
    return res.json({ success: true, data: mapped });
  } catch (e) {
    console.error('Fetch chats error:', e);
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
    const populated = await Chat.findById(chatId)
      .populate('participants', 'profile.firstName profile.lastName profile.avatar email role')
      .populate('admins', 'profile.firstName profile.lastName email')
      .lean();
    const data = {
      _id: populated._id,
      chatType: populated.chatType,
      settings: populated.settings || { announcementOnly: false, roleMentionsEnabled: true },
      pinnedMessageIds: populated.pinnedMessageIds || [],
      participants: populated.participants || [],
      admins: populated.admins || [],
      name: populated.name || null,
      description: populated.description || null
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
    
    // Fetch user to get muted list
    const user = await User.findById(req.user._id).select('mutedUsers').lean();
    const mutedIds = user?.mutedUsers || [];

    const query = {
        chat: chatId,
        // Exclude messages where the current user is in the hiddenFor list
        hiddenFor: { $ne: req.user._id },
        // Also exclude messages from currently muted users (hides history)
        sender: { $nin: mutedIds },
        $or: [
            { visibleToReceiver: true },
            { visibleToReceiver: { $exists: false } },
            { sender: req.user._id }
        ]
    };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'profile.firstName profile.lastName profile.avatar')
      .lean();

    return res.json({ success: true, data: messages });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

router.patch('/chats/:chatId/settings', async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) return res.status(400).json({ success: false, message: 'Invalid chatId' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });
    if (chat.chatType !== 'group') return res.status(400).json({ success: false, message: 'Settings only for groups' });
    const isAdmin = (chat.admins || []).map(a => a.toString()).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not allowed' });
    const update = {};
    if (typeof req.body.announcementOnly === 'boolean') update['settings.announcementOnly'] = req.body.announcementOnly;
    if (typeof req.body.roleMentionsEnabled === 'boolean') update['settings.roleMentionsEnabled'] = req.body.roleMentionsEnabled;
    await Chat.updateOne({ _id: chatId }, { $set: update });
    const updated = await Chat.findById(chatId).select('settings').lean();
    return res.json({ success: true, data: updated.settings || {} });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

router.patch('/chats/:chatId/name', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { name } = req.body;
    if (!mongoose.Types.ObjectId.isValid(chatId)) return res.status(400).json({ success: false, message: 'Invalid chatId' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat || chat.chatType !== 'group') return res.status(404).json({ success: false, message: 'Group not found' });
    const isAdmin = (chat.admins || []).map(a => a.toString()).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not allowed' });
    await Chat.updateOne({ _id: chatId }, { $set: { name: String(name || '').trim() } });
    const updated = await Chat.findById(chatId).select('name').lean();
    return res.json({ success: true, data: { name: updated.name } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update name' });
  }
});

router.patch('/chats/:chatId/image', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { image } = req.body;
    if (!mongoose.Types.ObjectId.isValid(chatId)) return res.status(400).json({ success: false, message: 'Invalid chatId' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat || chat.chatType !== 'group') return res.status(404).json({ success: false, message: 'Group not found' });
    const isAdmin = (chat.admins || []).map(a => a.toString()).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not allowed' });
    await Chat.updateOne({ _id: chatId }, { $set: { image: String(image || '').trim() || null } });
    const updated = await Chat.findById(chatId).select('image').lean();
    return res.json({ success: true, data: { image: updated.image } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update image' });
  }
});

router.patch('/chats/:chatId/members', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { action, userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: 'Invalid ids' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat || chat.chatType !== 'group') return res.status(404).json({ success: false, message: 'Group not found' });
    const isAdmin = (chat.admins || []).map(a => a.toString()).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not allowed' });
    if (action === 'add') {
      await Chat.updateOne({ _id: chatId }, { $addToSet: { participants: userId } });
      try {
        await User.updateOne({ _id: userId }, { $pull: { deletedChats: chatId } });
      } catch {}
    } else if (action === 'remove') {
      await Chat.updateOne({ _id: chatId }, { $pull: { participants: userId, admins: userId } });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    const updated = await Chat.findById(chatId).populate('participants', 'profile.firstName profile.lastName profile.avatar email role').populate('admins', 'profile.firstName profile.lastName email').lean();
    return res.json({ success: true, data: { participants: updated.participants, admins: updated.admins } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update members' });
  }
});

router.patch('/chats/:chatId/admins', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { action, userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: 'Invalid ids' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat || chat.chatType !== 'group') return res.status(404).json({ success: false, message: 'Group not found' });
    const isAdmin = (chat.admins || []).map(a => a.toString()).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not allowed' });
    if (action === 'promote') {
      await Chat.updateOne({ _id: chatId }, { $addToSet: { admins: userId } });
    } else if (action === 'demote') {
      await Chat.updateOne({ _id: chatId }, { $pull: { admins: userId } });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    const updated = await Chat.findById(chatId).select('admins').populate('admins', 'profile.firstName profile.lastName email').lean();
    return res.json({ success: true, data: { admins: updated.admins } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update admins' });
  }
});

router.patch('/chats/:chatId/leave', async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) return res.status(400).json({ success: false, message: 'Invalid chatId' });
    const chat = await Chat.findById(chatId).lean();
    if (!chat || chat.chatType !== 'group') return res.status(404).json({ success: false, message: 'Group not found' });
    await Chat.updateOne({ _id: chatId }, { $pull: { participants: req.user._id, admins: req.user._id } });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to leave group' });
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
    // Filter out hidden messages
    query.hiddenFor = { $ne: req.user._id };
    query.$or = query.$or || []; // Ensure $or exists if we added regex
    if (query.$or.length === 0) delete query.$or;
    
    // For 1:1, also check visibleToReceiver
    if (chat.chatType !== 'group') {
         // Logic: if I am recipient, visibleToReceiver must not be false
         // MongoDB query for this:
         // $and: [
         //   { $or: [ { visibleToReceiver: true }, { visibleToReceiver: { $exists: false } }, { sender: req.user._id } ] }
         // ]
         // We can merge this into the main query
         query.$and = [
            { $or: [ { visibleToReceiver: true }, { visibleToReceiver: { $exists: false } }, { sender: req.user._id } ] }
         ];
    }

    const items = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('sender', 'profile.firstName profile.lastName profile.avatar')
      .lean();
    let filtered = items;
    // (Legacy filter logic removed as we rely on DB query now)
    
    return res.json({ success: true, data: filtered });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// Delete Chat (Hide all messages for user)
router.post('/chats/:chatId/delete', async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chatId' });
    }
    
    // Hide all existing messages for this user
    await Message.updateMany(
        { chat: chatId },
        { $addToSet: { hiddenFor: req.user._id } }
    );
    
    // Also remove from archivedChats if present, and add to deletedChats
    await User.updateOne({ _id: req.user._id }, { 
        $pull: { archivedChats: chatId },
        $addToSet: { deletedChats: chatId }
    });

    return res.json({ success: true, message: 'Chat deleted' });
  } catch (e) {
    console.error('Delete chat error:', e);
    return res.status(500).json({ success: false, message: 'Failed to delete chat' });
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
    .populate('participants', 'profile.firstName profile.lastName profile.avatar email')
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
        .populate('participants', 'profile.firstName profile.lastName profile.avatar email')
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
      .select('email role profile.firstName profile.lastName profile.department profile.avatar')
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
    const user = await User.findById(userId).select('privacy.shadowMuted').lean();
    const mutedIds = (user?.privacy?.shadowMuted || []).map((entry) => {
      const uid = (entry?.user || entry);
      return uid ? uid.toString() : null;
    }).filter(Boolean);

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
        .populate('participants', 'profile.firstName profile.lastName profile.avatar email')
        .lean();
      if (!chat) continue;
      const other = (chat.participants || []).find(p => p._id.toString() !== userId.toString());
      if (!other) continue;
      if (mutedIds.includes(other._id.toString())) continue;
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
