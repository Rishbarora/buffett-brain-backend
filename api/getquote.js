// File: /api/getquote.js
// Purpose: return one Buffett paragraph that matches a random “seed” word

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

// ——— initialise SDK clients with the same secrets you already set in Vercel ———
const genAI   = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// helper: generate a polite fallback if nothing is found
const FAIL_MSG = 'No relevant quote was located. Please refresh for another.';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { seed } = req.body;                     // 1. receive the seed word
    if (!seed) return res.status(400).json({ error: 'Seed word is required.' });

    // 2. embed the seed word
    const embedModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const { embedding } = await embedModel.embedContent(seed);
    const vector      = embedding.values;

    // 3. search Pinecone for the closest paragraph
    const index  = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const result = await index
      .namespace('buffett-wisdom-namespace')
      .query({ vector, topK: 1, includeMetadata: true });

    // 4. assemble the reply
    const quote = (result.matches && result.matches[0]?.metadata?.text) || FAIL_MSG;
    res.status(200).json({ quote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error in getquote.' });
  }
};
// already have `quote` = match.metadata.text
async function shrinkToOneLiner(paragraph) {
  const prompt = `
  Rewrite the following Warren Buffett paragraph as one concise quote
  (max 35 words) in his voice. Remove line-breaks and quotation marks.

  Paragraph:
  """${paragraph}"""
  `;
  const chat = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
  const resp = await chat.generateContent(prompt);
  return resp.response.text().trim().replace(/^"|"$/g, '');
}

quote = await shrinkToOneLiner(quote);