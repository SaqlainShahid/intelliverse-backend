const Ticket = require('../../models/Ticket');
const Groq = require('groq-sdk'); // Import Groq SDK
const { searchRelevant, upsertPolicies } = require('../rag');
const ChatMessage = require('../../models/ChatMessage');
const Query = require('../../models/Query');
const Department = require('../../models/Department');
const { classifyAndAnswer } = require('../../services/aiService');
const canonicalMap = {
  'AU_Academic_Regulatios.pdf': 'https://au.edu.pk/Pages/Academics/assets/forms/AU_Regulation_2025_21_November.pdf',
  'AU_Academic_Calendar_2025_26_s1.pdf': 'https://www.au.edu.pk/Pages/AUInfo/pdf/AU_Academic_Calendar_2025_26_s1.pdf'
};

// Initialize Groq client
const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const ALLOWED_QUERY_TAGS = new Set(['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other']);

// Helper to create a pending query for admin
async function createAutoQuery(userId, queryText, aiAnswer, confidence) {
  try {
    // 1. Classify to get Department
    const aiResult = await classifyAndAnswer(queryText);
    const rawTag = aiResult?.tag;
    const tag = ALLOWED_QUERY_TAGS.has(rawTag) ? rawTag : 'Other';
    
    // 2. Find Department ID
    let department = await Department.findOne({ name: tag });
    if (!department && tag !== 'Other') department = await Department.findOne({ name: 'Other' });
    
    // 3. Create Query
    const query = new Query({
      userId: userId,
      message: queryText,
      tag: tag,
      department: department ? department._id : null,
      originDepartment: department ? department._id : null,
      collaboratingDepartments: [],
      status: 'pending',
      aiConfidence: confidence,
      aiResponse: aiAnswer,
      history: [{
        sender: userId,
        message: queryText
      }]
    });

    await query.save();

    // 4. Notify Department Admins
    if (department && global.io && department.admins && department.admins.length > 0) {
      department.admins.forEach(adminId => {
        global.io.to(adminId.toString()).emit('query:new', query);
      });
    }
    
    console.log(`Auto-created query for user ${userId}: ${query._id} (Confidence: ${confidence})`);
    return query;
  } catch (err) {
    console.error('Failed to auto-create query:', err);
    return null;
  }
}

async function generateAIAnswer(query, contextItems) {
  if (!contextItems || !contextItems.length) {
    return "Sorry, this information is not available in the academic regulations document.";
  }
  const contextText = contextItems.map((c, idx) => `Chunk ${idx + 1} (source: ${c.metadata?.filename || 'unknown'}):\n${c.text}`).join('\n\n');
  const systemPrompt = `You are a university AI helpdesk assistant.
Answer ONLY using the provided context from academic regulations.
If the answer is not found in the context, reply:
'Sorry, this information is not available in the academic regulations document.'
Do not guess. Do not use general knowledge.`;

  try {
    const content = `Student question: "${query}"

Style: Write a brief, clear answer in a friendly tone. If available, include relevant section/page reference noted in the context headers. Do not add any information that is not present in the context.

Context:
${contextText}`;
    const resp = await groqClient.chat.completions.create({
      model: "llama-3.1-8b-instant", // Using Llama3.1 8B Instant model
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: content },
      ],
      stream: false,
    });
    const answer = resp.choices[0].message.content || '';
    return answer.trim();
  } catch (groqError) {
    throw groqError; // Re-throw to be caught by the main ask function's catch block
  }
}

async function ask(req, res) {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, message: 'Query is required' });
    }
    const fallbackText = "Sorry, this information is not available in the academic regulations document.";
    const qraw = String(query || '').trim().toLowerCase();
    const isGreeting = /^(hi|hello|hey|hlo|hloo|salam|assalam|aoa|good (morning|afternoon|evening)|how are you|yo)\b/.test(qraw);
    if (isGreeting) {
      const friendly = 'Hi! I can help with academic regulations and the academic calendar. What would you like to know?';
      return res.json({ success: true, data: { answer: friendly, confidence: 0, escalated: false, sources: [], sourceUrlRelative: null } });
    }

    await upsertPolicies().catch(() => {});

    const { items, confidence } = await searchRelevant(query, 5);
    if (!items || !items.length) {
      if (req.user?._id) {
        await ChatMessage.create({ userId: req.user._id, role: 'user', content: query, confidence: 0, sources: [], sourceUrlRelative: null });
        await ChatMessage.create({ userId: req.user._id, role: 'assistant', content: fallbackText, confidence: 0, sources: [], sourceUrlRelative: null });
        
        // Auto-create Query for Admin
        await createAutoQuery(req.user._id, query, fallbackText, 0);
      }
      return res.json({ success: true, data: { answer: fallbackText, confidence: 0, escalated: false, sources: [] } });
    }

    const answer = await generateAIAnswer(query, items);
    const sources = items.map(it => ({ filename: it.metadata?.filename, page: it.metadata?.page })).filter(s => s.filename);
    const sourceUrlRelative = sources.length ? `/${sources[0].filename}` : null;
    const sourceUrl = sources.length ? (canonicalMap[sources[0].filename] || null) : null;

    const result = { success: true, data: { answer, confidence, escalated: false, sources, sourceUrlRelative, sourceUrl } };
    if (req.user?._id) {
      await ChatMessage.create({ userId: req.user._id, role: 'user', content: query, confidence: 0, sources: [], sourceUrlRelative: null });
      await ChatMessage.create({ userId: req.user._id, role: 'assistant', content: answer, confidence, sources, sourceUrlRelative, sourceUrl });

      const isFallback = String(answer || '').trim().toLowerCase() === fallbackText.toLowerCase();
      if (isFallback) await createAutoQuery(req.user._id, query, answer, confidence);
    }

    return res.json(result);
  } catch (err) {
    console.error('Chatbot error:', err);
    const fallback = "Sorry, this information is not available in the academic regulations document.";
    
    // Attempt to create query even on error
    if (req.user?._id) {
       await createAutoQuery(req.user._id, req.body.query || 'Unknown Query', fallback, 0);
    }
    
    return res.json({ success: true, data: { answer: fallback, confidence: 0, escalated: false, sources: [] } });
  }
}

async function escalate(req, res) {
  try {
    const { query, aiAnswer = '', confidence = 0 } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query is required' });
    }
    const ticket = await Ticket.create({
      title: query.slice(0, 180),
      description: `AI escalation for query:\n\n${query}\n\nAI tentative answer:\n${aiAnswer || 'N/A'}\n\nConfidence: ${Number(confidence).toFixed(2)}`,
      category: 'administrative',
      priority: 'medium',
      status: 'open',
      reportedBy: req.user._id,
      department: req.user?.profile?.department || 'general',
      escalated: true,
      escalatedAt: new Date(),
      tags: ['ai-escalation']
    });
    return res.json({ success: true, data: { ticketId: ticket._id } });
  } catch (err) {
    console.error('Chatbot escalate error:', err);
    return res.status(500).json({ success: false, message: 'Failed to escalate' });
  }
}

module.exports = { ask, escalate };
