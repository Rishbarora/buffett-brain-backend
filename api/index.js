// This is your entire backend "librarian"
// File: /api/index.js

// Import the tools we need
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

// Get our secret keys from Vercel's environment variables
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// This is the main function that runs when someone calls our API
module.exports = async (req, res) => {
  // Allow our Bubble frontend to talk to this API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle pre-flight requests for browsers
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. Get the user's question from the request
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    // 2. Embed the user's question into a vector
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004"});
    const embeddingResult = await embeddingModel.embedContent(question);
    const questionVector = embeddingResult.embedding.values;

    // 3. Query Pinecone to find relevant context
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const queryResponse = await index.namespace('buffett-wisdom-namespace').query({
      vector: questionVector,
      topK: 4, // Get the top 4 most relevant chunks
      includeMetadata: true,
    });

    // 4. Combine the context from Pinecone's results
    const context = queryResponse.matches.map(match => match.metadata.text).join('\n\n---\n\n');

    // 5. Ask the Gemini chat model to generate the final answer
    const chatModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const prompt = `Based ONLY on the following context from Warren Buffett's writings, answer the user's question. Be direct and concise. If the context isn't sufficient, say "Based on the provided materials, I don't have a specific answer to that question."\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${question}\n\nANSWER:`;

    const result = await chatModel.generateContent(prompt);
    const answer = result.response.text();

    // 6. Send the final answer back to the frontend
    res.status(200).json({ answer });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
};