const { embedWithRetry } = require('../../clients/deepseekClient');
const Vector = require('../../models/Vector');
const { calculateCosineSimilarity } = require('../../utils/similarity');

async function upsertPolicies() {
  console.log('Placeholder for upsertPolicies function - implement actual logic later.');
  // TODO: Implement actual policy upsertion logic here
}

async function searchRelevant(query, nResults = 4) {
  try {
    const qEmb = await embedWithRetry(query);
    const docs = await Vector.find({ 'embedding.0': { $exists: true } }, { chunk: 1, embedding: 1, source: 1, page: 1, wordCount: 1 }).lean();

    const qTokens = (query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const synonyms = new Set([
      'semester','semesters','start','starts','begin','begins','commence','commencement','opening',
      'calendar','academic','date','dates','start date','start of semester'
    ]);
    const qSet = new Set(qTokens.concat(Array.from(synonyms)));
    const termRegex = new RegExp(Array.from(qSet).join('|'), 'i');

    const scored = docs.map(d => {
      const text = d.chunk || '';
      const tTokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const tSet = new Set(tTokens);
      let overlap = 0;
      for (const tk of qSet) {
        if (tSet.has(tk)) overlap += 1;
      }
      const lt = text.toLowerCase();
      const phraseBoost = (lt.includes('semester start') || lt.includes('start date') || lt.includes('semester begins') || lt.includes('commence') || lt.includes('begin')) ? 2 : 0;
      const lexScore = overlap + phraseBoost;
      const cos = calculateCosineSimilarity(qEmb, d.embedding);
      const score = (0.7 * cos) + (0.3 * Math.min(1, lexScore / Math.max(3, Math.sqrt(d.wordCount || tTokens.length || 1))));
      return { text, metadata: { filename: d.source, page: d.page }, score };
    });

    scored.sort((a, b) => b.score - a.score);
    let top = scored.slice(0, nResults);
    const bestScore = top[0]?.score || 0;
    if (!top.length || bestScore < 0.12) {
      const lexMatches = await Vector.find({ chunk: { $regex: termRegex } }, { chunk: 1, source: 1, page: 1 }).lean();
      const expanded = lexMatches.map(d => ({ text: d.chunk, metadata: { filename: d.source, page: d.page }, score: 0.15 }));
      top = [...top, ...expanded];
      top.sort((a, b) => b.score - a.score);
      top = top.slice(0, nResults);
    }
    const confidence = top.length ? Math.max(0, Math.min(1, top[0].score)) : 0.2;
    return { items: top, confidence };
  } catch {
    return { items: [], confidence: 0.2 };
  }
}

module.exports = { searchRelevant, upsertPolicies };
