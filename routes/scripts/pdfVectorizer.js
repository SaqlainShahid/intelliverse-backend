const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mongoose = require('mongoose');
const { embedWithRetry } = require('../clients/deepseekClient');
const Vector = require('../models/Vector');
require('dotenv').config();

function cleanText(text) {
  let t = text || '';
  t = t.replace(/\r/g, '');
  t = t.replace(/(\w)-\n(\w)/g, '$1$2');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

function chunkByWords(text, minWords = 300, maxWords = 500) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    const cut = end;
    const chunkWords = words.slice(start, cut);
    if (chunkWords.length >= minWords || end === words.length) {
      const chunk = chunkWords.join(' ').trim();
      if (chunk) chunks.push(chunk);
      start = cut;
    } else {
      start = cut;
    }
  }
  return chunks;
}

async function main() {
  const mongo = process.env.MONGODB_URI;
  if (!mongo) throw new Error('MONGODB_URI missing');
  await mongoose.connect(mongo);

  const publicDir = path.resolve(__dirname, '../../frontend/public');
  let pdfPath = path.join(publicDir, 'AU_Academic_Regulations.pdf');
  if (!fs.existsSync(pdfPath)) {
    const candidates = fs.readdirSync(publicDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const match = candidates.find(f => /regulat/i.test(f) || /academic/i.test(f)) || candidates[0];
    if (!match) throw new Error('No PDF found in frontend/public');
    pdfPath = path.join(publicDir, match);
  }

  const dataBuffer = fs.readFileSync(pdfPath);
  const parsed = await pdf(dataBuffer);
  const text = cleanText(parsed.text || '');
  const numpages = parsed.numpages || null;
  let chunks = chunkByWords(text, 300, 500);
  const limit = parseInt(process.env.EMBED_MAX_CHUNKS || '0');
  if (limit > 0) chunks = chunks.slice(0, limit);

  const ingestOnly = String(process.env.INGEST_ONLY || '').toLowerCase() === 'true';
  for (let i = 0; i < chunks.length; i++) {
    const t = chunks[i];
    const wc = t.split(/\s+/).filter(Boolean).length;
    const vec = ingestOnly ? [] : await embedWithRetry(t);
    const page = numpages ? Math.min(numpages, Math.floor((i / chunks.length) * numpages) + 1) : null;
    await Vector.updateOne(
      { chunkId: `reg-${i}` },
      { chunkId: `reg-${i}`, chunk: t, embedding: vec, page, source: path.basename(pdfPath), wordCount: wc },
      { upsert: true }
    );
    await new Promise(r => setTimeout(r, 250));
  }

  if (ingestOnly) {
    console.log(`Ingested ${chunks.length} chunks from ${path.basename(pdfPath)} (no embeddings)`);
  } else {
    console.log(`Vectorized ${chunks.length} chunks from ${path.basename(pdfPath)}`);
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Vectorization error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
