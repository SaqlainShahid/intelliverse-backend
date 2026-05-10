const { embedWithRetry } = require('../../clients/deepseekClient');
const Vector = require('../../models/Vector');
const { calculateCosineSimilarity } = require('../../utils/similarity');

async function upsertPolicies() {
  console.log('Placeholder for upsertPolicies function - implement actual logic later.');
  // TODO: Implement actual policy upsertion logic here
}

async function searchRelevant(query, nResults = 5) {
  try {
    const qTokens = (query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    
    // 1. Semantic Search (Vector)
    const qEmb = await embedWithRetry(query);
    const vectorDocs = await Vector.find(
      { 'embedding.0': { $exists: true } }, 
      { chunk: 1, embedding: 1, source: 1, page: 1, wordCount: 1 }
    ).lean();

    // 2. Keyword Search (Text Index)
    const textDocs = await Vector.find(
      { $text: { $search: query } },
      { score: { $meta: "textScore" }, chunk: 1, source: 1, page: 1, wordCount: 1 }
    ).sort({ score: { $meta: "textScore" } }).limit(10).lean();

    const allDocsMap = new Map();

    // Process Vector Results
    vectorDocs.forEach(d => {
      const cos = calculateCosineSimilarity(qEmb, d.embedding);
      allDocsMap.set(d._id.toString(), { 
        text: d.chunk, 
        metadata: { filename: d.source, page: d.page }, 
        score: cos * 0.8 // Base vector weight
      });
    });

    // Process Text Results (Hybrid Boost)
    textDocs.forEach(d => {
      const id = d._id.toString();
      const existing = allDocsMap.get(id);
      const textBoost = 0.4;
      if (existing) {
        existing.score += textBoost;
      } else {
        allDocsMap.set(id, {
          text: d.chunk,
          metadata: { filename: d.source, page: d.page },
          score: textBoost
        });
      }
    });

    const combined = Array.from(allDocsMap.values());
    combined.sort((a, b) => b.score - a.score);
    
    const top = combined.slice(0, nResults);
    
    // Higher precision confidence calculation
    const confidence = top.length ? Math.min(1, top[0].score) : 0.2;
    
    return { items: top, confidence };
  } catch (err) {
    console.error('SearchRelevant Error:', err);
    return { items: [], confidence: 0 };
  }
}

module.exports = { searchRelevant, upsertPolicies };
