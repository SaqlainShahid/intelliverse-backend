const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalRateLimiter } = require('../middleware/rateLimiter');
const { ask, escalate } = require('../modules/chatbot/chatbotController');
const ChatMessage = require('../models/ChatMessage');

router.use(authenticate);

router.post('/ask', generalRateLimiter, ask);
router.post('/escalate', generalRateLimiter, escalate);
router.get('/history', generalRateLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);
    const userId = req.user?._id;
    if (!userId) {
      return res.json({ success: true, data: { messages: [] } });
    }
    const msgs = await ChatMessage.find({ userId }).sort({ createdAt: 1 }).limit(limit).lean();
    return res.json({ success: true, data: { messages: msgs } });
  } catch {
    return res.json({ success: true, data: { messages: [] } });
  }
});

router.delete('/history', generalRateLimiter, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.json({ success: true, data: { deleted: 0 } });
    const { deletedCount } = await ChatMessage.deleteMany({ userId });
    return res.json({ success: true, data: { deleted: deletedCount } });
  } catch {
    return res.json({ success: true, data: { deleted: 0 } });
  }
});

module.exports = router;
