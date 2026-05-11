const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const ChatRequest = require('../models/ChatRequest');
const Notification = require('../models/Notification');
const Club = require('../models/Club');
const Event = require('../models/Event');
const GroupRequest = require('../models/GroupRequest');
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
          category: c.category || null,
          clubId: c.club || null,
          eventId: c.event || null,
          admins: (c.admins || []).map(id => id.toString()),
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
      description: populated.description || null,
      category: populated.category || null,
      clubId: populated.club || null,
      eventId: populated.event || null
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
      if (chat.category === 'event' && chat.event) {
        const ev = await Event.findById(chat.event).lean();
        if (!ev) return res.status(404).json({ success: false, message: 'Event not found' });
        const isAttendee = (ev.attendees || []).some(a => a.user?.toString() === userId.toString());
        let isClubMember = false;
        if (ev.organizer) {
          const club = await Club.findById(ev.organizer).lean();
          isClubMember = !!club && (club.members || []).some(m => m.user?.toString() === userId.toString());
        }
        if (!isAttendee || !isClubMember) {
          return res.status(400).json({ success: false, message: 'User must join club and event' });
        }
      }
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


// POST /p2p/broadcast — Admin or faculty sends a broadcast message
router.post('/broadcast', authorize('admin', 'faculty'), async (req, res) => {
  try {
    const { message, filters = {}, groupName } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    const { scope, departments } = filters;
    const currentUser = await User.findById(req.user._id).select('profile.department').lean();
    const currentUserId = new mongoose.Types.ObjectId(req.user._id);

    const q = { isActive: true, _id: { $ne: currentUserId } };

    if (scope === 'same' && currentUser?.profile?.department) {
      // My department only
      q['profile.department'] = new RegExp(`^${currentUser.profile.department.trim()}$`, 'i');
    } else if (Array.isArray(departments) && departments.length > 0) {
      // Specific selected departments
      q['profile.department'] = { $in: departments };
    }
    // else: no department filter → entire university

    const matchedUsers = await User.find(q).select('_id').lean();
    if (matchedUsers.length === 0) {
      return res.status(400).json({ success: false, message: 'No users match the selected filters' });
    }

    const memberIds = [req.user._id.toString(), ...matchedUsers.map(u => u._id.toString())];
    const adminIds = [req.user._id.toString()];

    const name = (groupName || '').trim() || `Broadcast — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    const chat = await Chat.create({
      chatType: 'group',
      name,
      description: 'Admin broadcast group',
      admins: adminIds,
      participants: memberIds,
      category: 'broadcast',
      settings: { announcementOnly: true },
    });

    const msg = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      content: message.trim(),
      type: 'text',
    });

    await Chat.findByIdAndUpdate(chat._id, { lastMessage: msg._id });

    if (global.io) {
      memberIds.forEach(uid => {
        global.io.to(uid).emit('message:new', { chatId: chat._id, message: msg });
        global.io.to(uid).emit('chat:new', { chatId: chat._id });
      });
    }

    return res.json({ success: true, data: { chatId: chat._id, recipientCount: matchedUsers.length } });
  } catch (e) {
    console.error('[/broadcast] error:', e);
    return res.status(500).json({ success: false, message: 'Broadcast failed' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { search = '', limit = 12, role, department, departments: deptsParam, scope, designation, employeeType, expertise } = req.query;
    const departmentsFilter = deptsParam ? deptsParam.split(',').map(d => d.trim()).filter(Boolean) : [];
    console.log('[/users] PARAMS received:', { search, role, scope, department, departments: departmentsFilter, designation, employeeType, limit });

    const currentUser = await User.findById(req.user._id).select('profile.department role').lean();
    console.log('[/users] currentUser dept:', currentUser?.profile?.department, '| role:', currentUser?.role);

    const currentUserId = new mongoose.Types.ObjectId(req.user._id);
    const q = { isActive: true, _id: { $ne: currentUserId } };

    // Text search — name OR email
    const s = (search || '').trim();
    if (s) {
      q.$or = [
        { email: { $regex: s, $options: 'i' } },
        { 'profile.firstName': { $regex: s, $options: 'i' } },
        { 'profile.lastName': { $regex: s, $options: 'i' } },
      ];
    }

    // Role filter — must match exact enum value
    const validRoles = ['student', 'faculty', 'hod', 'admin'];
    if (role && role !== 'all' && validRoles.includes(role.toLowerCase())) {
      q.role = role.toLowerCase();
    }

    // Scope filter — same dept or cross dept (overrides department filter)
    if (scope === 'same' && currentUser?.profile?.department) {
      q['profile.department'] = new RegExp(`^${currentUser.profile.department.trim()}$`, 'i');
    } else if (scope === 'cross') {
      if (departmentsFilter.length > 0) {
        // Specific departments selected — filter to exactly those
        q['profile.department'] = { $in: departmentsFilter };
      } else if (currentUser?.profile?.department) {
        // No specific selection — show everyone except the user's own dept
        q['profile.department'] = { $not: new RegExp(`^${currentUser.profile.department.trim()}$`, 'i') };
      }
    } else if (department && department !== 'all') {
      q['profile.department'] = { $regex: department, $options: 'i' };
    }

    // Designation filter — Dr. or Professor title
    if (designation && designation !== 'all') {
      if (designation === 'dr') {
        q['profile.designation'] = { $regex: '^dr\\.?', $options: 'i' };
      } else if (designation === 'professor') {
        q['profile.designation'] = { $regex: 'professor', $options: 'i' };
      }
    }

    // Employment type filter — permanent or visiting
    if (employeeType && employeeType !== 'all') {
      q['profile.employeeType'] = employeeType;
    }

    // Expertise filter
    if (expertise) {
      q['expertise'] = { $elemMatch: { $regex: expertise.trim(), $options: 'i' } };
    }

    console.log('[/users] MongoDB query:', JSON.stringify(q, null, 2));

    const users = await User.find(q)
      .select('email role profile.firstName profile.lastName profile.department profile.designation profile.employeeType profile.avatar profile.rollNumber expertise officeHours')
      .sort({ 'profile.firstName': 1 })
      .limit(parseInt(limit))
      .lean();

    console.log('[/users] results count:', users.length, '| roles:', users.map(u => u.role));

    return res.json({ success: true, data: users });
  } catch (e) {
    console.error('[/users] search error:', e);
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
router.get('/groups/meta', authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const departments = await User.distinct('profile.department', { isActive: true, 'profile.department': { $exists: true, $ne: null } });
    const batchesRaw = await User.distinct('profile.semester', { isActive: true, 'profile.semester': { $exists: true } });
    const batches = (batchesRaw || []).filter((v) => typeof v === 'number' || typeof v === 'string').map((v) => String(v)).filter(Boolean);
    return res.json({ success: true, data: { departments, batches } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load group meta' });
  }
});

// GET /p2p/directory/stats — department overview + totals for the directory browse view
router.get('/directory/stats', async (req, res) => {
  try {
    const [deptStats, roleStats] = await Promise.all([
      User.aggregate([
        { $match: { isActive: true, 'profile.department': { $exists: true, $ne: null } } },
        { $group: { _id: { dept: '$profile.department', role: '$role' }, count: { $sum: 1 } } },
        { $group: {
          _id: '$_id.dept',
          total:    { $sum: '$count' },
          faculty:  { $sum: { $cond: [{ $in: ['$_id.role', ['faculty', 'hod']] }, '$count', 0] } },
          students: { $sum: { $cond: [{ $eq: ['$_id.role', 'student'] }, '$count', 0] } },
        }},
        { $sort: { total: -1 } },
      ]),
      User.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
    ]);

    const totals = roleStats.reduce((acc, r) => {
      acc[r._id] = r.count;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        departments: deptStats.map(d => ({ name: d._id, total: d.total, faculty: d.faculty, students: d.students })),
        totals: {
          faculty:  (totals.faculty  || 0) + (totals.hod || 0),
          students:  totals.student  || 0,
          total:    Object.values(totals).reduce((a, b) => a + b, 0),
        },
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load directory stats' });
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

// ============ CHAT REQUEST ENDPOINTS ============

// Check if user needs approval to message another user
router.get('/can-message/:recipientId', async (req, res) => {
  try {
    const { recipientId } = req.params;
    const senderId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ success: false, message: 'Invalid recipientId' });
    }

    if (recipientId.toString() === senderId.toString()) {
      return res.json({ success: true, data: { canMessage: true, requiresApproval: false } });
    }

    const sender = await User.findById(senderId).select('role').lean();
    const recipient = await User.findById(recipientId).select('role').lean();

    if (!sender || !recipient) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Role-based hierarchy logic
    const senderRole = sender.role;
    const recipientRole = recipient.role;

    let requiresApproval = false;

    // Admin can message everyone without approval
    if (senderRole === 'admin') {
      requiresApproval = false;
    }
    // HOD needs approval to message admin, but not faculty/student
    else if (senderRole === 'hod') {
      requiresApproval = recipientRole === 'admin';
    }
    // Faculty needs approval to message HOD and Admin, but not students
    else if (senderRole === 'faculty') {
      requiresApproval = recipientRole === 'hod' || recipientRole === 'admin';
    }
    // Students need approval from everyone
    else if (senderRole === 'student') {
      requiresApproval = true;
    }

    // Check if request already exists
    const existingRequest = await ChatRequest.findOne({
      sender: senderId,
      receiver: recipientId,
      status: { $in: ['pending', 'accepted'] }
    }).lean();

    const canMessage = !requiresApproval || existingRequest?.status === 'accepted';

    res.json({
      success: true,
      data: {
        canMessage,
        requiresApproval,
        requestStatus: existingRequest?.status || null
      }
    });
  } catch (error) {
    console.error('Can message check error:', error);
    res.status(500).json({ success: false, message: 'Failed to check messaging permission' });
  }
});

// Send chat request
router.post('/requests/send', async (req, res) => {
  try {
    const { recipientId, message } = req.body;
    const senderId = req.user._id;

    console.log('Send chat request:', { senderId, recipientId, message });

    if (!recipientId) {
      return res.status(400).json({ success: false, message: 'Recipient ID is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ success: false, message: 'Invalid recipient ID' });
    }

    if (recipientId.toString() === senderId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot send request to yourself' });
    }

    const recipient = await User.findById(recipientId).select('profile.firstName profile.lastName email').lean();
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Recipient not found' });
    }

    // Check if request already exists
    const existingRequest = await ChatRequest.findOne({
      sender: senderId,
      receiver: recipientId,
      status: 'pending'
    }).lean();

    if (existingRequest) {
      return res.status(400).json({ success: false, message: 'Request already pending' });
    }

    // Check if already accepted
    const acceptedRequest = await ChatRequest.findOne({
      sender: senderId,
      receiver: recipientId,
      status: 'accepted'
    }).lean();

    if (acceptedRequest) {
      return res.status(400).json({ success: false, message: 'You are already connected with this user' });
    }

    // Create request
    const request = await ChatRequest.create({
      sender: senderId,
      receiver: recipientId,
      message: message || null
    });

    console.log('Chat request created:', request._id);

    const populated = await ChatRequest.findById(request._id)
      .populate('sender', 'profile.firstName profile.lastName profile.avatar profilePicture role')
      .populate('receiver', 'profile.firstName profile.lastName profile.avatar profilePicture role');

    // Create notification
    try {
      await Notification.create({
        type: 'chat_request',
        recipient: recipientId,
        sender: senderId,
        data: {
          requestId: request._id,
          senderName: `${req.user.profile.firstName} ${req.user.profile.lastName}`
        }
      });
      console.log('Notification created for chat request');
    } catch (notifError) {
      console.error('Failed to create notification:', notifError);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      success: true,
      message: 'Chat request sent successfully',
      data: populated
    });
  } catch (error) {
    console.error('Send request error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send chat request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get pending requests for current user
router.get('/requests/pending', async (req, res) => {
  try {
    const userId = req.user._id;

    const requests = await ChatRequest.find({
      receiver: userId,
      status: 'pending'
    })
      .populate('sender', 'profile.firstName profile.lastName profile.avatar profile.designation profile.department role email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending requests' });
  }
});

// Get all requests (sent and received)
router.get('/requests/all', async (req, res) => {
  try {
    const userId = req.user._id;

    const [incoming, outgoing] = await Promise.all([
      ChatRequest.find({ receiver: userId })
        .populate('sender', 'profile.firstName profile.lastName profile.avatar role')
        .sort({ createdAt: -1 })
        .lean(),
      ChatRequest.find({ sender: userId })
        .populate('receiver', 'profile.firstName profile.lastName profile.avatar role')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    res.json({
      success: true,
      data: { incoming, outgoing }
    });
  } catch (error) {
    console.error('Get all requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requests' });
  }
});

// Accept chat request
router.post('/requests/:requestId/accept', async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: 'Invalid requestId' });
    }

    const request = await ChatRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.receiver.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only receiver can accept request' });
    }

    if (request.status === 'accepted') {
      // Already accepted — return success so UI can sync without an error modal
      const populated = await ChatRequest.findById(request._id)
        .populate('sender', 'profile.firstName profile.lastName profile.avatar role')
        .populate('receiver', 'profile.firstName profile.lastName profile.avatar role');
      return res.json({ success: true, message: 'Chat request accepted', data: populated });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
    }

    request.status = 'accepted';
    request.acceptedAt = new Date();
    request.read = true;
    await request.save();

    const populated = await ChatRequest.findById(request._id)
      .populate('sender', 'profile.firstName profile.lastName profile.avatar role')
      .populate('receiver', 'profile.firstName profile.lastName profile.avatar role');

    // Create notification safely — never crash the accept flow
    try {
      const acceptingUser = await User.findById(userId).select('profile.firstName profile.lastName').lean();
      await Notification.create({
        user: request.sender,
        type: 'chat_request_accepted',
        title: 'Chat Request Accepted',
        message: `${acceptingUser?.profile?.firstName || ''} ${acceptingUser?.profile?.lastName || ''} accepted your chat request`.trim(),
        data: { requestId: request._id }
      });
    } catch (notifErr) {
      console.warn('[accept] Notification creation skipped:', notifErr.message);
    }

    res.json({
      success: true,
      message: 'Chat request accepted',
      data: populated
    });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept chat request' });
  }
});

// Decline chat request
router.post('/requests/:requestId/decline', async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: 'Invalid requestId' });
    }

    const request = await ChatRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.receiver.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only receiver can decline request' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
    }

    request.status = 'declined';
    request.declinedAt = new Date();
    request.read = true;
    await request.save();

    const populated = await ChatRequest.findById(request._id)
      .populate('sender', 'profile.firstName profile.lastName profile.avatar role')
      .populate('receiver', 'profile.firstName profile.lastName profile.avatar role');

    res.json({
      success: true,
      message: 'Chat request declined',
      data: populated
    });
  } catch (error) {
    console.error('Decline request error:', error);
    res.status(500).json({ success: false, message: 'Failed to decline chat request' });
  }
});

// Delete/Cancel chat request (sender can cancel their own pending request)
router.delete('/requests/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID' });
    }

    const request = await ChatRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Only sender can delete their own request
    if (request.sender.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own requests' });
    }

    // Can only delete pending requests
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot delete ${request.status} request` });
    }

    await ChatRequest.findByIdAndDelete(requestId);

    res.json({
      success: true,
      message: 'Chat request deleted successfully'
    });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete chat request' });
  }
});

// Block user (also declines pending request)
router.post('/requests/block/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    if (userId.toString() === currentUserId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot block yourself' });
    }

    // Decline any pending request
    const request = await ChatRequest.findOne({
      $or: [
        { sender: currentUserId, receiver: userId, status: 'pending' },
        { sender: userId, receiver: currentUserId, status: 'pending' }
      ]
    });

    if (request) {
      request.status = 'declined';
      request.declinedAt = new Date();
      await request.save();
    }

    // Add to blocked list
    await User.updateOne(
      { _id: currentUserId },
      { $addToSet: { 'privacy.blocked': userId } }
    );

    res.json({
      success: true,
      message: 'User blocked successfully'
    });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ success: false, message: 'Failed to block user' });
  }
});

// Unblock user
router.post('/requests/unblock/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    await User.updateOne(
      { _id: currentUserId },
      { $pull: { 'privacy.blocked': userId } }
    );

    res.json({
      success: true,
      message: 'User unblocked successfully'
    });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ success: false, message: 'Failed to unblock user' });
  }
});

// ─── Expertise & Office Hours ────────────────────────────────────────────────

// Faculty updates their expertise tags
router.patch('/expertise', authorize('faculty', 'hod'), async (req, res) => {
  try {
    const { expertise } = req.body;
    if (!Array.isArray(expertise)) return res.status(400).json({ success: false, message: 'expertise must be an array' });
    const sanitized = expertise.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
    await User.findByIdAndUpdate(req.user._id, { expertise: sanitized });
    return res.json({ success: true, data: { expertise: sanitized } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update expertise' });
  }
});

// Faculty updates their office hours
router.patch('/office-hours', authorize('faculty', 'hod'), async (req, res) => {
  try {
    const { officeHours } = req.body;
    if (!Array.isArray(officeHours)) return res.status(400).json({ success: false, message: 'officeHours must be an array' });
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const sanitized = officeHours
      .filter(s => DAYS.includes(s.day) && s.startTime && s.endTime)
      .map(s => ({ day: s.day, startTime: s.startTime, endTime: s.endTime, location: s.location || '', isActive: s.isActive !== false }));
    await User.findByIdAndUpdate(req.user._id, { officeHours: sanitized });
    return res.json({ success: true, data: { officeHours: sanitized } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update office hours' });
  }
});

// ─── Cross-Dept Analytics (admin / HOD) ──────────────────────────────────────
router.get('/analytics/overview', authorize('admin', 'hod'), async (req, res) => {
  try {
    const Query      = require('../models/Query');
    const ForumPost  = require('../models/ForumPost');
    const CollabRequest = require('../models/CollabRequest');

    const [queryByDept, forumByCat, userByRole, collabStats, forumAnswered] = await Promise.all([
      Query.aggregate([
        { $group: { _id: '$tag', total: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } } } },
        { $sort: { total: -1 } }
      ]),
      ForumPost.aggregate([
        { $group: { _id: '$category', total: { $sum: 1 }, answered: { $sum: { $cond: [{ $eq: ['$status', 'answered'] }, 1, 0] } } } },
        { $sort: { total: -1 } }
      ]),
      User.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      CollabRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, respondents: { $sum: { $size: '$respondents' } } } }
      ]),
      ForumPost.countDocuments({ 'answers.0': { $exists: true } }),
    ]);

    const userTotals = userByRole.reduce((a, r) => { a[r._id] = r.count; return a; }, {});
    const totalQueries = queryByDept.reduce((a, r) => a + r.total, 0);
    const totalResolved = queryByDept.reduce((a, r) => a + r.resolved, 0);
    const totalForum = forumByCat.reduce((a, r) => a + r.total, 0);
    const collabOpen = (collabStats.find(c => c._id === 'open') || {}).count || 0;
    const collabClosed = (collabStats.find(c => c._id === 'closed') || {}).count || 0;
    const collabResponses = collabStats.reduce((a, r) => a + r.respondents, 0);

    return res.json({
      success: true,
      data: {
        queries: {
          byDepartment: queryByDept.map(r => ({ dept: r._id, total: r.total, resolved: r.resolved, pending: r.total - r.resolved })),
          total: totalQueries,
          resolvedRate: totalQueries ? Math.round((totalResolved / totalQueries) * 100) : 0,
        },
        forum: {
          byCategory: forumByCat.map(r => ({ category: r._id, total: r.total, answered: r.answered })),
          total: totalForum,
          answeredCount: forumAnswered,
          answeredRate: totalForum ? Math.round((forumAnswered / totalForum) * 100) : 0,
        },
        users: {
          total: Object.values(userTotals).reduce((a, b) => a + b, 0),
          byRole: userTotals,
        },
        collaborate: {
          open: collabOpen,
          closed: collabClosed,
          totalResponses: collabResponses,
        },
      },
    });
  } catch (e) {
    console.error('[analytics/overview]', e);
    return res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
});

// ─── Group Requests (faculty → HOD approval) ─────────────────────────────────

// Faculty submits a group creation request
router.post('/group-requests', authorize('faculty'), async (req, res) => {
  try {
    const { type, key, name, description, memberEmails = [] } = req.body;
    if (!type || !['department', 'batch', 'course'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be department | batch | course' });
    }
    if (type === 'department' && !key) return res.status(400).json({ success: false, message: 'Department is required' });
    if (type === 'batch' && (key === undefined || key === null)) return res.status(400).json({ success: false, message: 'Semester is required' });
    if (type === 'course' && memberEmails.length < 2) return res.status(400).json({ success: false, message: 'At least 2 member emails are required for a course group' });

    const request = await GroupRequest.create({
      requestedBy: req.user._id,
      type, key: key ?? null, name: name || null, description: description || null,
      memberEmails: type === 'course' ? memberEmails : [],
    });

    // Notify all HODs via socket
    if (global.io) {
      const hods = await User.find({ role: 'hod', isActive: true }).select('_id').lean();
      hods.forEach(h => global.io.to(h._id.toString()).emit('groupRequest:new', { request }));
    }

    return res.status(201).json({ success: true, data: request });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to submit group request' });
  }
});

// HOD / admin lists pending group requests
router.get('/group-requests', authorize('admin', 'hod'), async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const requests = await GroupRequest.find({ status })
      .populate('requestedBy', 'profile.firstName profile.lastName profile.department email role')
      .populate('reviewedBy', 'profile.firstName profile.lastName')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: requests });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to load group requests' });
  }
});

// HOD / admin approves a request → creates the group
router.patch('/group-requests/:id/approve', authorize('admin', 'hod'), async (req, res) => {
  try {
    const gr = await GroupRequest.findById(req.params.id).populate('requestedBy', '_id');
    if (!gr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (gr.status !== 'pending') return res.status(400).json({ success: false, message: 'Request already reviewed' });

    // Build members list (same logic as auto-create)
    let members = [];
    if (gr.type === 'department') {
      const found = await User.find({ 'profile.department': gr.key, isActive: true }).select('_id').lean();
      members = found.map(u => u._id.toString());
    } else if (gr.type === 'batch') {
      const found = await User.find({ 'profile.semester': Number(gr.key), isActive: true }).select('_id').lean();
      members = found.map(u => u._id.toString());
    } else if (gr.type === 'course') {
      const found = await User.find({ email: { $in: gr.memberEmails }, isActive: true }).select('_id').lean();
      members = found.map(u => u._id.toString());
    }

    const requesterId = gr.requestedBy._id.toString();
    const memberIds = Array.from(new Set([req.user._id.toString(), requesterId, ...members]));

    const chat = await Chat.create({
      chatType: 'group',
      name: gr.name || (gr.type === 'department' ? `Department: ${gr.key}` : gr.type === 'batch' ? `Batch: ${gr.key}` : 'Course Group'),
      description: gr.description || null,
      admins: [req.user._id.toString(), requesterId],
      participants: memberIds,
      category: gr.type,
      meta: {
        department: gr.type === 'department' ? gr.key : null,
        batch: gr.type === 'batch' ? String(gr.key) : null,
        course: gr.type === 'course' ? (gr.key || null) : null,
      }
    });

    // Mark approved
    gr.status = 'approved';
    gr.reviewedBy = req.user._id;
    gr.reviewedAt = new Date();
    gr.resultChatId = chat._id;
    await gr.save();

    // Notify all members + requester
    if (global.io) {
      const payload = { _id: chat._id, type: 'group', group: { name: chat.name, memberCount: memberIds.length }, updatedAt: chat.updatedAt };
      memberIds.forEach(uid => global.io.to(uid).emit('group:created', payload));
      global.io.to(requesterId).emit('groupRequest:approved', { chatId: chat._id, name: chat.name });
    }

    return res.json({ success: true, data: { request: gr, chatId: chat._id } });
  } catch (e) {
    console.error('[group-requests/approve]', e);
    return res.status(500).json({ success: false, message: 'Failed to approve request' });
  }
});

// HOD / admin rejects a request
router.patch('/group-requests/:id/reject', authorize('admin', 'hod'), async (req, res) => {
  try {
    const { reason = '' } = req.body;
    const gr = await GroupRequest.findById(req.params.id).populate('requestedBy', '_id');
    if (!gr) return res.status(404).json({ success: false, message: 'Request not found' });
    if (gr.status !== 'pending') return res.status(400).json({ success: false, message: 'Request already reviewed' });

    gr.status = 'rejected';
    gr.reviewedBy = req.user._id;
    gr.reviewedAt = new Date();
    gr.rejectionReason = reason;
    await gr.save();

    if (global.io) {
      global.io.to(gr.requestedBy._id.toString()).emit('groupRequest:rejected', { requestId: gr._id, reason });
    }

    return res.json({ success: true, data: gr });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to reject request' });
  }
});

module.exports = router;
