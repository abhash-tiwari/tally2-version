const TallyData = require('../models/TallyData');
const { getEmbedding } = require('../utils/embedding');
const { findMostSimilarChunks } = require('../utils/vectorSearch');
const axios = require('axios');

exports.chat = async (req, res) => {
  try {
    const { sessionId, question } = req.body;
    console.log('[CHAT] Received question:', question, 'for session:', sessionId);
    if (!sessionId || !question) return res.status(400).json({ error: 'Missing sessionId or question' });

    const tallyData = await TallyData.findOne({ sessionId });
    if (!tallyData) {
      console.log('[CHAT] No data found for session:', sessionId);
      return res.status(404).json({ error: 'Session not found' });
    }
    console.log('[CHAT] Data fetched from MongoDB. Chunks:', tallyData.dataChunks.length);
    if (tallyData.dataChunks.length > 0) {
      console.log('[CHAT] Example dataChunk:', tallyData.dataChunks[0]);
    }

    // Embed the question
    const queryEmbedding = await getEmbedding(question);
    console.log('[CHAT] Query embedding generated.');

    // Find most relevant data chunks
    const topChunks = findMostSimilarChunks(queryEmbedding, tallyData.dataChunks, 5);
    console.log('[CHAT] Raw topChunks:', topChunks);
    console.log('[CHAT] Top chunks selected for context:');
    topChunks.forEach((c, i) => {
     const content = c.content || (c._doc && c._doc.content);
    if (typeof content === 'string') {
      console.log(`  Chunk ${i+1}: ${content}`);
    } else {
      console.log(`  Chunk ${i+1}: [No content]`, c);
      }
 });

    // Build context for OpenAI
    const context = topChunks.map(chunk => chunk.content || (chunk._doc && chunk._doc.content) || '').join('\n');

    // Compose improved prompt with explicit instructions and a few-shot example
    const prompt = `You are an expert accountant. The following is the user's Tally data. Each line is a record in the format: "Account | Amount | Type". Use this data to answer the user's question as accurately as possible. If the answer is present in the data, use it directly. If not, say you cannot find it in the data.\n\nExample:\nTally Data:\nElectricity | 5000 | Expense\nSalary | 20000 | Income\n\nQuestion: What is my current electricity expense?\nAnswer: Your current electricity expense is 5000.\n\nTally Data:\n${context}\n\nQuestion: ${question}\nAnswer:`;
    console.log('[CHAT] Calling OpenAI API...');

    // Call OpenAI API using axios
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant for Tally data analysis.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 512,
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const answer = openaiRes.data.choices[0].message.content;
    console.log('[CHAT] OpenAI answer:', answer.substring(0, 300));
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat failed' });
  }
};