const Groq = require('groq-sdk');
const Department = require('../models/Department');

let groqClient = null;
const getGroqClient = () => {
  if (groqClient) return groqClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  groqClient = new Groq({ apiKey });
  return groqClient;
};

const DEFAULT_TAGS = ['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other'];
const AUTO_ANSWER_CONFIDENCE_THRESHOLD = 0.7;

let deptCache = { loadedAt: 0, departments: [] };

const loadDepartmentsCached = async () => {
  const now = Date.now();
  if (deptCache.departments.length && now - deptCache.loadedAt < 5 * 60 * 1000) {
    return deptCache.departments;
  }
  const depts = await Department.find().lean();
  deptCache = { loadedAt: now, departments: Array.isArray(depts) ? depts : [] };
  return deptCache.departments;
};

const getSystemPrompt = (depts) => {
  const deptList = depts.map(d => `- ${d.name}: ${d.keywords?.join(', ') || 'General queries'}`).join('\n');
  return `
You are the intelligent assistant for IntelliVerse, a smart campus application.
Your goal is to classify student queries, tag them with the correct department, and answer them if possible.

Available Departments (Tags):
${deptList}
- Other: Anything not matching above

Output Format (JSON only):
{
  "intent": "question" | "greeting" | "complaint" | "other",
  "tag": "Department Name",
  "confidence": 0.0 to 1.0,
  "answer": "Your answer here if you are confident or 'null'"
}
`;
};

const normalize = (v) =>
  String(v || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const countKeywordMatches = (text, keywords) => {
  const t = normalize(text);
  if (!t) return 0;
  const list = Array.isArray(keywords) ? keywords : [];
  let score = 0;
  for (const kwRaw of list) {
    const kw = normalize(kwRaw);
    if (!kw) continue;
    if (kw.includes(' ')) {
      if (t.includes(kw)) score += 2;
      continue;
    }
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t)) score += 1;
  }
  return score;
};

const tryFaqAnswer = async (message, depts) => {
  const msg = normalize(message);
  if (!msg) return null;

  let best = null;
  for (const dept of depts) {
    const faqs = Array.isArray(dept?.faqs) ? dept.faqs : [];
    for (const faq of faqs) {
      const qText = normalize(faq?.question);
      const kwScore = countKeywordMatches(msg, faq?.keywords);
      const qScore = qText && msg.includes(qText) ? 3 : 0;
      const score = kwScore + qScore;
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { score, tag: dept?.name, answer: faq?.answer };
      }
    }
  }

  if (!best) return null;
  const answer = typeof best.answer === 'string' ? best.answer.trim() : '';
  if (!answer) return null;
  return { intent: 'question', tag: best.tag, confidence: 0.9, answer };
};

const tryKeywordTag = async (message, depts) => {
  const msg = normalize(message);
  if (!msg) return null;

  let best = null;
  for (const dept of depts) {
    const score = countKeywordMatches(msg, dept?.keywords);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { tag: dept.name, score };
  }
  if (!best || best.score < 1) return null;
  return best.tag;
};

const classifyAndAnswer = async (message) => {
  try {
    const depts = await loadDepartmentsCached();
    const allowedTags = new Set(depts.map(d => d.name));
    allowedTags.add('Other');

    const faqHit = await tryFaqAnswer(message, depts);
    if (faqHit) return faqHit;

    const groq = getGroqClient();
    if (!groq) {
      const keywordTag = await tryKeywordTag(message, depts);
      return { intent: 'other', tag: keywordTag || 'Other', confidence: 0, answer: null };
    }
    
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: getSystemPrompt(depts) },
        { role: 'user', content: message }
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from AI');

    const result = JSON.parse(content);
    const rawTag = result?.tag;
    const tag = allowedTags.has(rawTag) ? rawTag : 'Other';
    const confidence = typeof result?.confidence === 'number' ? result.confidence : Number(result?.confidence) || 0;
    let answer = result?.answer;
    if (answer === 'null') answer = null;
    if (typeof answer === 'string') answer = answer.trim();
    if (!answer) answer = null;

    const keywordTag = (confidence < 0.55 || tag === 'Other') ? await tryKeywordTag(message, depts) : null;
    const finalTag = keywordTag || tag;
    const finalAnswer = confidence >= AUTO_ANSWER_CONFIDENCE_THRESHOLD ? answer : null;

    return {
      intent: result?.intent || 'other',
      tag: finalTag,
      confidence: confidence,
      answer: finalAnswer
    };

  } catch (error) {
    console.error('AI Service Error:', error);
    return {
      intent: 'other',
      tag: 'Other',
      confidence: 0,
      answer: null
    };
  }
};

module.exports = {
  classifyAndAnswer
};