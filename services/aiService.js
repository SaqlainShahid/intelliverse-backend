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

const ALLOWED_QUERY_TAGS = new Set(['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other']);
const AUTO_ANSWER_CONFIDENCE_THRESHOLD = 0.7;

// System prompt to guide the AI
const SYSTEM_PROMPT = `
You are the intelligent assistant for IntelliVerse, a smart campus application.
Your goal is to classify student queries, tag them with the correct department, and answer them if possible.

Available Departments (Tags):
- IT: Technical issues, login, wifi, portal access
- Finance: Fees, scholarships, fines, payments
- Exams: Datesheet, results, grading, rechecking
- Admissions: Application, eligibility, merit lists
- Hostel: Room allocation, mess, complaints
- Library: Books, fines, digital resources
- Career: Internships, jobs, counseling
- Other: Anything not matching above

Output Format (JSON only):
{
  "intent": "question" | "greeting" | "complaint" | "other",
  "tag": "Department Name",
  "confidence": 0.0 to 1.0 (score representing how certain you are about the tag AND the answer),
  "answer": "Your answer here if you are confident (general knowledge) or 'null' if it requires department action."
}

If the query matches a common FAQ (e.g., "When are exams?", "How to reset password?"), provide a direct answer and high confidence (0.8+).
If the query is specific to a student's personal record (e.g., "What is my GPA?", "Why is my fee pending?"), set "answer" to null and confidence for the TAG only.
If you are unsure of the answer but have a suggestion, provide the answer but lower confidence (< 0.7).
`;

let deptCache = { loadedAt: 0, departments: [] };

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

const loadDepartmentsCached = async () => {
  const now = Date.now();
  if (deptCache.departments.length && now - deptCache.loadedAt < 5 * 60 * 1000) {
    return deptCache.departments;
  }
  const depts = await Department.find().lean();
  deptCache = { loadedAt: now, departments: Array.isArray(depts) ? depts : [] };
  return deptCache.departments;
};

const tryFaqAnswer = async (message) => {
  const depts = await loadDepartmentsCached();
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
  if (!ALLOWED_QUERY_TAGS.has(best.tag)) return null;
  const answer = typeof best.answer === 'string' ? best.answer.trim() : '';
  if (!answer) return null;
  return { intent: 'question', tag: best.tag, confidence: 0.9, answer };
};

const tryKeywordTag = async (message) => {
  const depts = await loadDepartmentsCached();
  const msg = normalize(message);
  if (!msg) return null;

  let best = null;
  for (const dept of depts) {
    const tag = dept?.name;
    if (!ALLOWED_QUERY_TAGS.has(tag)) continue;
    const score = countKeywordMatches(msg, dept?.keywords);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { tag, score };
  }
  if (!best || best.score < 1) return null;
  return best.tag;
};

const classifyAndAnswer = async (message) => {
  try {
    const faqHit = await tryFaqAnswer(message);
    if (faqHit) return faqHit;

    const groq = getGroqClient();
    if (!groq) {
      const keywordTag = await tryKeywordTag(message);
      return { intent: 'other', tag: keywordTag || 'Other', confidence: 0, answer: null };
    }
    
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      model: 'llama-3.1-8b-instant', // Updated model
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from AI');

    const result = JSON.parse(content);
    const rawTag = result?.tag;
    const tag = ALLOWED_QUERY_TAGS.has(rawTag) ? rawTag : 'Other';
    const confidence = typeof result?.confidence === 'number' ? result.confidence : Number(result?.confidence) || 0;
    let answer = result?.answer;
    if (answer === 'null') answer = null;
    if (typeof answer === 'string') answer = answer.trim();
    if (!answer) answer = null;

    const keywordTag = (confidence < 0.55 || tag === 'Other') ? await tryKeywordTag(message) : null;
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
    // Fallback
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