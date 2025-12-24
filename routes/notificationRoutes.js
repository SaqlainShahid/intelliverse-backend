const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Notification = require('../models/Notification');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { unread = 'false', limit = '50' } = req.query;
    const q = { user: req.user._id };
    if (String(unread) === 'true') q.isRead = false;
    const items = await Notification.find(q)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json({ success: true, data: items, unreadCount });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
});

router.post('/read', async (req, res) => {
  try {
    const { ids = [], all = false } = req.body || {};
    let result;
    if (all) {
      result = await Notification.updateMany({ user: req.user._id, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
    } else if (Array.isArray(ids) && ids.length) {
      result = await Notification.updateMany({ user: req.user._id, _id: { $in: ids } }, { $set: { isRead: true, readAt: new Date() } });
    } else {
      return res.status(400).json({ success: false, message: 'Provide ids or set all=true' });
    }
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
    res.json({ success: true, updated: result.modifiedCount || 0, unreadCount });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
});

router.post('/clear', async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
    const unreadCount = 0;
    res.json({ success: true, unreadCount });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to clear notifications' });
  }
});

module.exports = router;

