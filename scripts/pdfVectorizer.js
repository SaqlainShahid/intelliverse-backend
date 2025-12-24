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
  const pdfFiles = fs.readdirSync(publicDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (!pdfFiles.length) throw new Error('No PDF found in frontend/public');

  function makeSlug(filename) {
    const n = filename.toLowerCase();
    if (/regulat/.test(n) || n === 'au_academic_regulatios.pdf' || n === 'au_academic_regulations.pdf') return 'reg';
    if (/calendar/.test(n)) return n.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return n.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  const ingestOnly = String(process.env.INGEST_ONLY || '').toLowerCase() === 'true';
  let totalChunks = 0;
  for (const file of pdfFiles) {
    const pdfPath = path.join(publicDir, file);
    const dataBuffer = fs.readFileSync(pdfPath);
    const parsed = await pdf(dataBuffer);
    const text = cleanText(parsed.text || '');
    const numpages = parsed.numpages || null;
    let chunks = chunkByWords(text, 300, 500);
    const limit = parseInt(process.env.EMBED_MAX_CHUNKS || '0');
    if (limit > 0) chunks = chunks.slice(0, limit);
    const slug = makeSlug(path.basename(pdfPath));

    for (let i = 0; i < chunks.length; i++) {
      const t = chunks[i];
      const wc = t.split(/\s+/).filter(Boolean).length;
      const vec = ingestOnly ? [] : await embedWithRetry(t);
      const page = numpages ? Math.min(numpages, Math.floor((i / chunks.length) * numpages) + 1) : null;
      const chunkId = `${slug}-${i}`;
      await Vector.updateOne(
        { chunkId },
        { chunkId, chunk: t, embedding: vec, page, source: path.basename(pdfPath), wordCount: wc },
        { upsert: true }
      );
      totalChunks++;
      await new Promise(r => setTimeout(r, 250));
    }
  }

  console.log(`${ingestOnly ? 'Ingested' : 'Vectorized'} ${totalChunks} chunks from ${pdfFiles.length} PDF(s) in frontend/public`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Vectorization error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
