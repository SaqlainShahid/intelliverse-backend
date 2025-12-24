const express = require('express');
const router = express.Router();
const { chatWithRetry } = require('../clients/deepseekClient');
const { searchRelevant } = require('../modules/rag');
const { authenticate } = require('../middleware/auth');
const canonicalMap = {
  'AU_Academic_Regulatios.pdf': 'https://au.edu.pk/Pages/Academics/assets/forms/AU_Regulation_2025_21_November.pdf',
  'AU_Academic_Calendar_2025_26_s1.pdf': 'https://www.au.edu.pk/Pages/AUInfo/pdf/AU_Academic_Calendar_2025_26_s1.pdf'
};

// DeepSeek client provides retry/backoff; add local similarity util

router.use(authenticate);

router.post('/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }
    const qraw = String(question || '').trim().toLowerCase();
    const isGreeting = /^(hi|hello|hey|hlo|hloo|salam|assalam|aoa|good (morning|afternoon|evening)|how are you|yo)\b/.test(qraw);
    if (isGreeting) {
      const friendly = 'Hi! I can help with academic regulations and the academic calendar. What would you like to know?';
      return res.json({ success: true, data: { answer: friendly, confidence: 0, sources: [], sourceUrlRelative: null, escalated: false } });
    }

    const { items, confidence } = await searchRelevant(question, 5);
    if (!items || !items.length) {
      const fallback = "Sorry, this information is not available in the academic regulations document.";
      return res.json({ success: true, data: { answer: fallback, confidence: 0, sources: [], escalated: false } });
    }

    const context = items.map((c, i) => `Chunk ${i + 1} (source: ${c.metadata?.filename || 'unknown'}, page: ${c.metadata?.page ?? 'N/A'}):\n${c.text}`).join('\n\n');
    const messages = [
      { role: 'system', content: `You are a university AI helpdesk assistant.
Answer ONLY using the provided context from academic regulations.
If the answer is not found in the context, reply:
'Sorry, this information is not available in the academic regulations document.'
Do not guess. Do not use general knowledge.` },
      { role: 'user', content: `Student question: "${question}"

Style: Write a brief, clear answer in a friendly tone. If available, include relevant section/page reference noted in the context headers. Do not add any information that is not present in the context.

Context:
${context}` }
    ];

    const answer = await chatWithRetry(messages);
    const lowConfidence = !answer || answer.trim().length < 20;
    const sources = items.map(it => ({ filename: it.metadata?.filename, page: it.metadata?.page })).filter(s => s.filename);
    const sourceUrlRelative = sources.length ? `/${sources[0].filename}` : null;
    const sourceUrl = sources.length ? (canonicalMap[sources[0].filename] || null) : null;
    const finalAnswer = lowConfidence ? "Sorry, this information is not available in the academic regulations document." : answer.trim();
    return res.json({ success: true, data: { answer: finalAnswer, confidence, sources, sourceUrlRelative, sourceUrl, escalated: false } });
  } catch (e) {
    const fallback = "Sorry, this information is not available in the academic regulations document.";
    return res.json({ success: true, data: { answer: fallback, confidence: 0, sources: [], escalated: false } });
  }
});

module.exports = router;
