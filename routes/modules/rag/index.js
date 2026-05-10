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
    const docs = await Vector.find({ 'embedding.0': { $exists: true } }, { chunk: 1, embedding: 1, source: 1, page: 1 }).lean();
    const scored = docs.map(d => ({ text: d.chunk, metadata: { filename: d.source, page: d.page }, score: calculateCosineSimilarity(qEmb, d.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, nResults);
    const confidence = top.length ? Math.max(0, Math.min(1, top[0].score)) : 0.2;
    return { items: top, confidence };
  } catch {
    return { items: [], confidence: 0.2 };
  }
}

module.exports = { searchRelevant, upsertPolicies };
