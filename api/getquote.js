// File: /api/getquote.js
// Purpose: return a short Buffett quote each time the frontend requests one

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

const genAI   = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

module.exports = async (req, res) => {
  // CORS for the Bubble / Framer / Bolt frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    /* 1. validate body */
    const { seed } = req.body;
    if (!seed) return res.status(400).json({ error: 'Seed word is required.' });

    /* 2. embed the seed word */
    const embedModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const { embedding } = await embedModel.embedContent(seed);
    const vector = embedding.values;

    /* 3. query Pinecone for the closest paragraph */
    const index   = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const result  = await index
                      .namespace('buffett-wisdom-namespace')
                      .query({ vector, topK: 1, includeMetadata: true });

    let quote = result.matches?.[0]?.metadata?.text || 
                'No relevant Buffett text found. Please try again.';

    /* 4. optional — shrink to a one-liner (Gemini) */
    quote = await shrinkToOneLiner(quote);

    /* 5. return to the caller */
    res.status(200).json({ quote });

  } catch (err) {
    console.error('getquote error', err);
    res.status(500).json({ error: 'Internal error in getquote.' });
  }
};

/* helper: Gemini rewrites paragraph into ≤35-word quote */
async function shrinkToOneLiner(paragraph) {
  const prompt =
    `Rewrite the following Warren Buffett paragraph as one concise quote ` +
    `(max 35 words). Keep Buffett’s voice. Remove line-breaks and extra quotes.\n\n` +
    `Paragraph:\n"""${paragraph}"""`;

  try {
    const chatModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const { response } = await chatModel.generateContent(prompt);
    return response.text().replace(/^"|"$/g, '').trim();
  } catch (err) {
    console.error('trim-with-Gemini error', err);
    // Fall back to cleaned paragraph if rewrite fails
    return paragraph.replace(/\s{2,}/g, ' ').replace(/\n+/g, ' ').trim();
  }
}
