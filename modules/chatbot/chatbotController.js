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

// Helper to refine natural language query into search terms
async function refineQuery(query) {
  try {
    const resp = await groqClient.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { 
          role: "system", 
          content: "You are a search query optimizer. Given a student question, extract the main academic/administrative keywords and correct any typos (e.g., 'nexam' -> 'exam'). Return ONLY the optimized query string." 
        },
        { role: "user", content: query }
      ],
      temperature: 0.1,
    });
    return resp.choices[0].message.content || query;
  } catch {
    return query;
  }
}



async function generateAIAnswer(query, contextItems = [], history = []) {
  const contextText = contextItems.length 
    ? contextItems.map((c, idx) => `[Source ${idx + 1} (${c.metadata?.filename || 'Regulations'})]:\n${c.text}`).join('\n\n')
    : "No direct regulatory documentation found for this specific query.";

  const historyText = history.length
    ? history.map(h => `${h.role === 'user' ? 'Student' : 'Assistant'}: ${h.content}`).join('\n')
    : "No previous conversation history.";

  const systemPrompt = `You are a Senior University Systems Assistant for IntelliVerse.
Your mission is to provide high-precision support using University Assets (PDFs) and general intelligence.

CORE LOGIC:
1. ANCHORING: Always check the 'Regulatory Context' first. If it contains the answer, stick to it and cite the source.
2. CONTINUITY: Use the 'Conversation History' to understand context. If the student says "Tell me more about THAT", "THAT" refers to the previous topic in history.
3. HYBRID KNOWLEDGE: If the Regulations context is insufficient, leverage your full intelligence to help. 
4. PERSONA: Be authoritative yet welcoming. Act as a top-tier educational consultant.
5. FORMATTING: Use professional Markdown with bolding for key terms.

STRICT RULE: If you are making a general suggestion not found in PDFs, phrase it as "Based on general university practices..."`;

  try {
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
      { 
        role: "user", 
        content: `Regulatory Context for Search:\n${contextText}\n\nStudent's New Question: "${query}"` 
      }
    ];

    const resp = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.35,
      max_tokens: 1024,
      top_p: 0.95
    });
    
    return resp.choices[0].message.content || '';
  } catch (groqError) {
    console.error('Groq Generation Error:', groqError);
    throw groqError;
  }
}

async function ask(req, res) {
  try {
    const { query } = req.body;
    const userId = req.user?._id;

    if (!query) return res.status(400).json({ success: false, message: 'Query is required' });

    // 1. Fetch Conversation Context (Nasa-grade memory approach)
    let chatHistory = [];
    if (userId) {
      chatHistory = await ChatMessage.find({ userId })
        .sort({ createdAt: -1 })
        .limit(8)
        .lean();
      chatHistory.reverse(); // Chronological order
    }

    const qraw = query.trim().toLowerCase();
    
    // Mission-critical handles
    if (/^(hi|hello|hey|yo|salam|hlo)\b/.test(qraw)) {
      const greeting = "Greetings! I'm your IntelliVerse Systems Assistant. I'm connected to the University Knowledge Base and ready to assist you with regulations, navigation, or general questions. What's on your mind?";
      return res.json({ success: true, data: { answer: greeting, confidence: 1, sources: [] } });
    }

    // 2. Intelligence Layer: Query Refinement & Context Synthesis
    const refinedQuery = await refineQuery(query);
    
    // 3. Retrieval Layer: Hybrid Semantic + Lexical Search
    const { items, confidence } = await searchRelevant(refinedQuery, 6);

    // 4. Generation Layer: Multi-Context Weighted Reasoning
    const answer = await generateAIAnswer(query, items, chatHistory);
    
    const sources = items.map(it => ({ 
      filename: it.metadata?.filename, 
      page: it.metadata?.page 
    })).filter(s => s.filename);

    const sourceUrlRelative = sources.length ? `/${sources[0].filename}` : null;
    const sourceUrl = sources.length ? (canonicalMap[sources[0].filename] || null) : null;

    const result = { 
      success: true, 
      data: { 
        answer, 
        confidence: items.length ? confidence : 0.6,
        sources: sources.slice(0, 2), 
        sourceUrlRelative, 
        sourceUrl 
      } 
    };

    // 5. Persistence & Feedback Loop
    if (userId) {
      await ChatMessage.create({ userId, role: 'user', content: query });
      await ChatMessage.create({ userId, role: 'assistant', content: answer, confidence, sources, sourceUrlRelative, sourceUrl });

      // Proactive Escalation Detection
      const indicators = ["not found", "sorry", "unfortunately", "contact", "official", "unsure"];
      const isUncertain = indicators.some(word => answer.toLowerCase().includes(word));
      
      if (isUncertain || (items.length > 0 && confidence < 0.22)) {
        await createAutoQuery(userId, query, answer, confidence);
      }
    }

    return res.json(result);
  } catch (err) {
    console.error('NASA-CONTROL: Chatbot Logic Failure:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'System connectivity compromised. Please retry mission command.' 
    });
  }
}

async function escalate(req, res) {
  try {
    const { query, aiAnswer = '', confidence = 0 } = req.body;
    const ticket = await Ticket.create({
      title: `System Escalation: ${query.slice(0, 60)}...`,
      description: `MANUAL ESCALATION DETECTED\n\nQuery: ${query}\nAI Logic State: ${aiAnswer}\nConfidence: ${confidence}`,
      category: 'administrative',
      priority: 'high',
      reportedBy: req.user._id,
      department: req.user?.profile?.department || 'general',
      escalated: true,
      tags: ['priority-support']
    });
    return res.json({ success: true, data: { ticketId: ticket._id } });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
}

module.exports = { ask, escalate };
