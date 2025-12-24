const axios = require('axios');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}
function hashingEmbed(text, dims = 512) {
  const v = new Array(dims).fill(0);
  const tokens = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const t of tokens) {
    const idx = fnv1a(t) % dims;
    v[idx] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
  return v;
}

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const API_KEY = process.env.DEEPSEEK_API_KEY;

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function embedWithRetry(text, maxRetries = 5) {
  if (API_KEY) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const resp = await http.post('/v1/embeddings', {
          model: 'deepseek-embedding',
          input: text
        });
        const vector = resp?.data?.data?.[0]?.embedding || [];
        return vector;
      } catch (err) {
        if (err?.response?.status === 429) {
          attempt++;
          await sleep(1000);
          continue;
        }
        break;
      }
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey });
      const resp = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text
      });
      const v = resp?.data?.[0]?.embedding || [];
      return v;
    } catch (err) {
      if (err?.status === 429) {
      } else {
        throw err;
      }
    }
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const embedModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const emb = await embedModel.embedContent(text);
      const v = emb?.embedding?.values || [];
      return v;
    } catch (err) {
      if (err?.status === 429) {
      } else {
        throw err;
      }
    }
  }
  return hashingEmbed(text);
}

async function chatWithRetry(messages, maxRetries = 5) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const resp = await http.post('/v1/chat/completions', {
        model: 'deepseek-chat',
        messages
      });
      const content = resp?.data?.choices?.[0]?.message?.content || '';
      return content;
    } catch (err) {
      if (err?.response?.status === 429) {
        attempt++;
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('DeepSeek chat rate-limited after retries');
}

module.exports = {
  embedWithRetry,
  chatWithRetry,
};
