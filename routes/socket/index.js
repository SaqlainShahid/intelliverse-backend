const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwtUtils');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');

const onlineUsers = new Map();

const initSocket = (server) => {
  if (global.io) return global.io;
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => callback(null, true),
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || (socket.handshake.headers.authorization || '').replace('Bearer ', '');
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;
      next();
    } catch (e) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    const existing = onlineUsers.get(userId) || new Set();
    existing.add(socket.id);
    onlineUsers.set(userId, existing);
    socket.join(userId);
    io.emit('presence', { userId, status: 'online' });
    io.emit('userConnected', { userId });

    socket.on('chat:join', (chatId) => {
      if (chatId) socket.join(chatId);
    });

    socket.on('typing', ({ chatId, recipientId, typing }) => {
      if (recipientId) io.to(recipientId).emit('typing', { chatId, userId, typing: !!typing });
      if (chatId) io.to(chatId).emit('typing', { chatId, userId, typing: !!typing });
    });
    socket.on('stopTyping', ({ chatId, recipientId }) => {
      if (recipientId) io.to(recipientId).emit('typing', { chatId, userId, typing: false });
      if (chatId) io.to(chatId).emit('typing', { chatId, userId, typing: false });
    });

    socket.on('message:send', async ({ chatId, recipientId, content, attachments = [], replyTo = null, poll = null }, ack) => {
      try {
        if (!chatId) return typeof ack === 'function' && ack({ ok: false });
        const chat = await Chat.findById(chatId)
          .populate('participants', 'profile.firstName profile.lastName role')
          .lean();
        if (!chat) return typeof ack === 'function' && ack({ ok: false });
        if (chat.chatType === 'group') {
          if (chat.settings?.announcementOnly) {
            const isAdmin = (chat.admins || []).map(a => a.toString()).includes(userId.toString());
            if (!isAdmin) return typeof ack === 'function' && ack({ ok: false, error: 'announcement_only' });
          }
          if (!content && (!attachments || !attachments.length) && !poll) return typeof ack === 'function' && ack({ ok: false });
          let payload;
          if (poll && typeof poll === 'object') {
            const msg = await Message.create({
              chat: chatId,
              sender: userId,
              type: 'poll',
              content: content || '',
              poll: {
                question: String(poll.question || '').trim() || null,
                options: Array.isArray(poll.options) ? poll.options.filter(o => o && o.text).map(o => ({ text: String(o.text) })) : [],
                multiple: !!poll.multiple,
                deadline: poll.deadline ? new Date(poll.deadline) : null,
                closed: false
              },
              replyTo: replyTo || null
            });
            await Chat.findByIdAndUpdate(chatId, { lastMessage: msg._id, updatedAt: new Date() });
            payload = { _id: msg._id, chat: chatId, sender: userId, type: msg.type, content: msg.content, poll: msg.poll, replyTo: msg.replyTo, status: msg.status, createdAt: msg.createdAt };
          } else {
            const msg = await Message.create({ chat: chatId, sender: userId, type: 'text', content: content || '', attachments, replyTo: replyTo || null });
            await Chat.findByIdAndUpdate(chatId, { lastMessage: msg._id, updatedAt: new Date() });
            payload = { _id: msg._id, chat: chatId, sender: userId, type: msg.type, content: msg.content, attachments: msg.attachments, replyTo: msg.replyTo, status: msg.status, createdAt: msg.createdAt };
          }
          io.to(chatId).emit('message:new', payload);
          io.to(chatId).emit('receiveMessage', payload);
          for (const p of (chat.participants || [])) {
            const pid = (p._id || p).toString();
            if (pid !== userId.toString()) {
              io.to(pid).emit('message:new', payload);
              io.to(pid).emit('receiveMessage', payload);
              try {
                const pref = await User.findById(pid).select('preferences.notificationsEnabled').lean();
                if (pref?.preferences?.notificationsEnabled !== false) {
                  const title = chat.name ? `New message in ${chat.name}` : 'New group message';
                  const n = await Notification.create({ user: pid, type: 'new_message', title, message: payload.content || null, data: { chatId, messageId: payload._id, senderId: userId } });
                  io.to(pid).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
                }
              } catch {}
            }
          }
          try {
            const text = (payload.content || '').toLowerCase();
            if (text.includes('@')) {
              const allowRoles = chat.settings?.roleMentionsEnabled !== false;
              const isAdmin = (chat.admins || []).map(a => a.toString()).includes(userId.toString());
              const tokens = Array.from(new Set(text.split(/\s+/).filter(w => w.startsWith('@')).map(w => w.replace(/[^\w@]/g, ''))));
              const roleTokens = tokens.filter(t => ['@all', '@admins', '@faculty', '@students'].includes(t));
              const nameTokens = tokens.filter(t => !roleTokens.includes(t));
              for (const p of (chat.participants || [])) {
                const pid = (p._id || p).toString();
                if (pid === userId.toString()) continue;
                const fn = (p.profile?.firstName || '').toLowerCase();
                const ln = (p.profile?.lastName || '').toLowerCase();
                const full = `${fn} ${ln}`.trim();
                const mentioned = nameTokens.some(tok => tok === `@${fn}` || tok === `@${full}`);
                if (mentioned) {
                  const pref = await User.findById(pid).select('preferences.notificationsEnabled').lean();
                  if (pref?.preferences?.notificationsEnabled !== false) {
                    const n = await Notification.create({ user: pid, type: 'mention', title: 'You were mentioned', message: payload.content || null, data: { chatId, messageId: payload._id, senderId: userId } });
                    io.to(pid).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
                  }
                }
              }
              if (allowRoles && roleTokens.length) {
                const toAll = roleTokens.includes('@all');
                const toAdmins = roleTokens.includes('@admins');
                const toFaculty = roleTokens.includes('@faculty');
                const toStudents = roleTokens.includes('@students');
                for (const p of (chat.participants || [])) {
                  const pid = (p._id || p).toString();
                  if (pid === userId.toString()) continue;
                  const role = p.role;
                  let target = false;
                  if (toAll) target = isAdmin;
                  if (toAdmins) target = target || (isAdmin && role === 'admin');
                  if (toFaculty) target = target || role === 'faculty';
                  if (toStudents) target = target || role === 'student';
                  if (target) {
                    const pref = await User.findById(pid).select('preferences.notificationsEnabled').lean();
                    if (pref?.preferences?.notificationsEnabled !== false) {
                      const n = await Notification.create({ user: pid, type: 'mention', title: 'Group mention', message: payload.content || null, data: { chatId, messageId: payload._id, senderId: userId } });
                      io.to(pid).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
                    }
                  }
                }
              }
            }
          } catch {}
          typeof ack === 'function' && ack({ ok: true, message: payload });
        } else {
          if (!recipientId || (!content && (!attachments || !attachments.length))) return typeof ack === 'function' && ack({ ok: false });
          const msg = await Message.create({ chat: chatId, sender: userId, recipient: recipientId, type: 'text', content: content || '', attachments, replyTo: replyTo || null });
          await Chat.findByIdAndUpdate(chatId, { lastMessage: msg._id, updatedAt: new Date() });
          const payload = { _id: msg._id, chat: chatId, sender: userId, recipient: recipientId, type: msg.type, content: msg.content, attachments: msg.attachments, replyTo: msg.replyTo, status: msg.status, createdAt: msg.createdAt };
          io.to(chatId).emit('message:new', payload);
          io.to(recipientId).emit('message:new', payload);
          io.to(recipientId).emit('receiveMessage', payload);
          try {
            const pref = await User.findById(recipientId).select('preferences.notificationsEnabled').lean();
            if (pref?.preferences?.notificationsEnabled !== false) {
              const n = await Notification.create({ user: recipientId, type: 'new_message', title: 'New message', message: payload.content || null, data: { chatId, messageId: payload._id, senderId: userId } });
              io.to(recipientId).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
            }
          } catch {}
          typeof ack === 'function' && ack({ ok: true, message: payload });
        }
      } catch (e) {
        typeof ack === 'function' && ack({ ok: false });
      }
    });

    socket.on('message:react', async ({ messageId, emoji }, ack) => {
      try {
        if (!messageId || !emoji) return typeof ack === 'function' && ack({ ok: false });
        const msg = await Message.findById(messageId);
        if (!msg) return typeof ack === 'function' && ack({ ok: false });
        const existingIdx = (msg.reactions || []).findIndex(r => r.user.toString() === userId.toString() && r.emoji === emoji);
        if (existingIdx !== -1) {
          msg.reactions.splice(existingIdx, 1);
        } else {
          msg.reactions.push({ emoji, user: userId, createdAt: new Date() });
        }
        await msg.save();
        const payload = { messageId, reactions: msg.reactions.map(r => ({ emoji: r.emoji, user: r.user })) };
        const room = msg.chat.toString();
        io.to(room).emit('message:reactions', payload);
        typeof ack === 'function' && ack({ ok: true, reactions: payload.reactions });
      } catch {
        typeof ack === 'function' && ack({ ok: false });
      }
    });

    socket.on('message:pin', async ({ chatId, messageId }, ack) => {
      try {
        if (!chatId || !messageId) return typeof ack === 'function' && ack({ ok: false });
        const chat = await Chat.findById(chatId);
        if (!chat) return typeof ack === 'function' && ack({ ok: false });
        const isAdmin = (chat.admins || []).map(a => a.toString()).includes(userId.toString());
        if (!isAdmin) return typeof ack === 'function' && ack({ ok: false });
        chat.pinnedMessageIds = chat.pinnedMessageIds || [];
        const exists = chat.pinnedMessageIds.some(id => id.toString() === messageId.toString());
        if (exists) {
          chat.pinnedMessageIds = chat.pinnedMessageIds.filter(id => id.toString() !== messageId.toString());
        } else {
          chat.pinnedMessageIds.push(messageId);
        }
        await chat.save();
        io.to(chatId).emit('chat:pins', { chatId, pinnedMessageIds: chat.pinnedMessageIds });
        typeof ack === 'function' && ack({ ok: true, pinnedMessageIds: chat.pinnedMessageIds });
      } catch {
        typeof ack === 'function' && ack({ ok: false });
      }
    });

    socket.on('message:edit', async ({ messageId, content }, ack) => {
      try {
        if (!messageId || typeof content !== 'string') return typeof ack === 'function' && ack({ ok: false });
        const msg = await Message.findById(messageId);
        if (!msg) return typeof ack === 'function' && ack({ ok: false });
        const chat = await Chat.findById(msg.chat).lean();
        const isAdmin = (chat.admins || []).map(a => a.toString()).includes(userId.toString());
        if (msg.sender.toString() !== userId.toString() && !isAdmin) return typeof ack === 'function' && ack({ ok: false });
        if (msg.isDeleted) return typeof ack === 'function' && ack({ ok: false });
        msg.content = content.trim();
        msg.editedAt = new Date();
        msg.editCount = (msg.editCount || 0) + 1;
        msg.audit = msg.audit || [];
        msg.audit.push({ action: 'edit', user: userId, at: new Date(), meta: { length: msg.content.length } });
        await msg.save();
        const payload = { messageId: msg._id, content: msg.content, editedAt: msg.editedAt, editCount: msg.editCount };
        const room = msg.chat.toString();
        io.to(room).emit('message:edited', payload);
        typeof ack === 'function' && ack({ ok: true, ...payload });
      } catch {
        typeof ack === 'function' && ack({ ok: false });
      }
    });

    socket.on('message:delete', async ({ messageId }, ack) => {
      try {
        if (!messageId) return typeof ack === 'function' && ack({ ok: false });
        const msg = await Message.findById(messageId);
        if (!msg) return typeof ack === 'function' && ack({ ok: false });
        const chat = await Chat.findById(msg.chat).lean();
        const isAdmin = (chat.admins || []).map(a => a.toString()).includes(userId.toString());
        if (msg.sender.toString() !== userId.toString() && !isAdmin) return typeof ack === 'function' && ack({ ok: false });
        msg.isDeleted = true;
        msg.deletedAt = new Date();
        msg.deletedBy = userId;
        msg.attachments = [];
        msg.audit = msg.audit || [];
        msg.audit.push({ action: 'delete', user: userId, at: new Date(), meta: null });
        await msg.save();
        const payload = { messageId: msg._id, isDeleted: true, deletedAt: msg.deletedAt };
        const room = msg.chat.toString();
        io.to(room).emit('message:deleted', payload);
        typeof ack === 'function' && ack({ ok: true, ...payload });
      } catch {
        typeof ack === 'function' && ack({ ok: false });
      }
    });

    socket.on('poll:vote', async ({ messageId, optionIndex }, ack) => {
      try {
        if (!messageId || optionIndex === undefined) return typeof ack === 'function' && ack({ ok: false });
        const msg = await Message.findById(messageId);
        if (!msg || msg.type !== 'poll') return typeof ack === 'function' && ack({ ok: false });
        const chat = await Chat.findById(msg.chat).lean();
        if (!chat || chat.chatType !== 'group') return typeof ack === 'function' && ack({ ok: false });
        if (msg.poll && msg.poll.deadline && new Date(msg.poll.deadline).getTime() < Date.now()) msg.poll.closed = true;
        if (msg.poll.closed) return typeof ack === 'function' && ack({ ok: false });
        const idx = Number(optionIndex);
        if (Number.isNaN(idx) || idx < 0 || idx >= (msg.poll.options || []).length) return typeof ack === 'function' && ack({ ok: false });
        msg.poll.options = msg.poll.options || [];
        if (msg.poll.multiple !== true) {
          for (let i = 0; i < msg.poll.options.length; i++) {
            msg.poll.options[i].votes = (msg.poll.options[i].votes || []).filter(v => v.toString() !== userId.toString());
          }
        }
        const votes = msg.poll.options[idx].votes || [];
        const has = votes.some(v => v.toString() === userId.toString());
        if (!has) votes.push(userId);
        msg.poll.options[idx].votes = votes;
        await msg.save();
        const payload = { messageId: msg._id, poll: { options: msg.poll.options.map(o => ({ text: o.text, count: (o.votes || []).length })) } };
        const room = msg.chat.toString();
        io.to(room).emit('poll:update', payload);
        typeof ack === 'function' && ack({ ok: true, ...payload });
      } catch {
        typeof ack === 'function' && ack({ ok: false });
      }
    });
    socket.on('message:received', async ({ messageId }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (msg.recipient && msg.recipient.toString() === userId.toString()) {
          if (msg.status === 'sent') {
            msg.status = 'delivered';
            msg.deliveredAt = new Date();
            await msg.save();
            io.to(msg.sender.toString()).emit('message:delivered', { messageId: msg._id });
          }
        } else {
          if (!msg.recipient) {
            const idx = (msg.receipts || []).findIndex(r => r.user.toString() === userId.toString());
            if (idx === -1) {
              msg.receipts.push({ user: userId, status: 'delivered', deliveredAt: new Date() });
            } else {
              msg.receipts[idx].status = 'delivered';
              msg.receipts[idx].deliveredAt = new Date();
            }
            await msg.save();
            io.to(msg.sender.toString()).emit('message:delivered', { messageId: msg._id });
          }
        }
      } catch {}
    });

    socket.on('message:seen', async ({ messageId }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (msg.recipient && msg.recipient.toString() === userId.toString()) {
          if (msg.status !== 'seen') {
            msg.status = 'seen';
            msg.seenAt = new Date();
            await msg.save();
            io.to(msg.sender.toString()).emit('message:seen', { messageId: msg._id });
          }
        } else {
          if (!msg.recipient) {
            const idx = (msg.receipts || []).findIndex(r => r.user.toString() === userId.toString());
            if (idx === -1) {
              msg.receipts.push({ user: userId, status: 'read', readAt: new Date() });
            } else {
              msg.receipts[idx].status = 'read';
              msg.receipts[idx].readAt = new Date();
            }
            await msg.save();
            io.to(msg.sender.toString()).emit('messageRead', { messageId: msg._id, userId });
          }
        }
      } catch {}
    });

    socket.on('disconnect', () => {
      const set = onlineUsers.get(userId) || new Set();
      set.delete(socket.id);
      if (set.size === 0) {
        onlineUsers.delete(userId);
        io.emit('presence', { userId, status: 'offline' });
        io.emit('userDisconnected', { userId });
      } else {
        onlineUsers.set(userId, set);
      }
    });
  });

  global.io = io;
  return io;
};

module.exports = { initSocket };
