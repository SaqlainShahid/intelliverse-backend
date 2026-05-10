const express = require('express');
const router = express.Router();
const Vector = require('../models/Vector');
const { embedWithRetry, chatWithRetry } = require('../clients/deepseekClient');
const { calculateCosineSimilarity } = require('../utils/similarity');
const { authenticate } = require('../middleware/auth');

// DeepSeek client provides retry/backoff; add local similarity util

router.use(authenticate);

router.post('/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }

    const qEmb = await embedWithRetry(question);

    const docs = await Vector.find({}, { chunk: 1, embedding: 1, page: 1 }).lean();
    const scored = docs.map(d => ({ text: d.chunk, page: d.page, score: calculateCosineSimilarity(qEmb, d.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);

    const threshold = parseFloat(process.env.RAG_MIN_SIM || '0.80');
    if (!top.length) {
      return res.json({ success: true, data: { answer: 'Sorry, I don’t have this information right now.' } });
    }

    if (top[0].score >= threshold) {
      return res.json({ success: true, data: { answer: top[0].text, bestMatch: { score: top[0].score, page: top[0].page } } });
    }

    const context = top.map((t, i) => `Chunk ${i + 1}:\n${t.text}`).join('\n\n');
    const messages = [
      { role: 'system', content: 'You are an assistant. Prefer using the provided context. If not relevant, answer concisely.' },
      { role: 'user', content: `Question: ${question}\n\nContext:\n${context}` }
    ];

    const answer = await chatWithRetry(messages);
    const lowConfidence = !answer || answer.trim().length < 20;
    return res.json({ success: true, data: { answer: lowConfidence ? 'Sorry, I don’t have this information right now.' : answer } });
  } catch (e) {
    const msg429 = 'Service temporarily unavailable due to AI quota or rate limits. Please try again later.';
    if (e && (e.status === 429 || e.code === 'insufficient_quota' || e.type === 'insufficient_quota')) {
      return res.json({ success: true, data: { answer: msg429 } });
    }
    console.error('Chat error:', e);
    return res.status(500).json({ success: false, message: 'Failed to answer question' });
  }
});

module.exports = router;
