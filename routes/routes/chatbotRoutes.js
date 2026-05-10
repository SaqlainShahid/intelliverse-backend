const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalRateLimiter } = require('../middleware/rateLimiter');
const { ask, escalate } = require('../modules/chatbot/chatbotController');

router.use(authenticate);

router.post('/ask', generalRateLimiter, ask);
router.post('/escalate', generalRateLimiter, escalate);

module.exports = router;

