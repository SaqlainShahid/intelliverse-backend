const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const RegulationEmbedding = require('../models/RegulationEmbedding');

const MONGODB_URI = process.env.MONGODB_URI;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

function chunkText(text, min = 800, max = 1200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + max, text.length);
    let cut = end;
    if (end < text.length) {
      const idx = text.lastIndexOf('\n', end);
      if (idx > start + min) cut = idx;
    }
    const chunk = text.slice(start, cut).trim();
    if (chunk) chunks.push(chunk);
    start = cut;
  }
  return chunks;
}

async function embedWithBackoff(text, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const emb = await embedModel.embedContent(text);
      return emb?.embedding?.values || [];
    } catch (err) {
      if (err && err.status === 429) {
        await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Rate limited by Gemini Embed API');
}

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(MONGODB_URI);

  const publicDir = path.resolve(__dirname, '../../frontend/public');
  let pdfPath = path.join(publicDir, 'AU_Academic_Regulations.pdf');
  if (!fs.existsSync(pdfPath)) {
    const candidates = fs.readdirSync(publicDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const match = candidates.find(f => /regulat/i.test(f) || /academic/i.test(f));
    if (match) pdfPath = path.join(publicDir, match);
  }
  const dataBuffer = fs.readFileSync(pdfPath);
  const parsed = await pdf(dataBuffer);
  const text = parsed.text || '';
  let chunks = chunkText(text);
  const maxChunks = parseInt(process.env.EMBED_MAX_CHUNKS || '0');
  if (maxChunks > 0) {
    chunks = chunks.slice(0, maxChunks);
  }

  for (let i = 0; i < chunks.length; i++) {
    const t = chunks[i];
    const vec = await embedWithBackoff(t);
    await RegulationEmbedding.updateOne(
      { chunkId: `reg-${i}` },
      { chunkId: `reg-${i}`, text: t, embedding: vec, source: path.basename(pdfPath), length: t.length },
      { upsert: true }
    );
    // small pacing to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`Embedded and stored ${chunks.length} chunks`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
