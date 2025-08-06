const TallyData = require('../models/TallyData');
const { getEmbedding } = require('../utils/embedding');
const { findMostSimilarChunks } = require('../utils/vectorSearch');
const { preprocessQuery, extractDateContext, createEnhancedPrompt } = require('../utils/queryPreprocessor');
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

    // Preprocess the question for better matching
    const enhancedQuestion = preprocessQuery(question);
    const dateContext = extractDateContext(question);
    console.log('[CHAT] Date context detected:', dateContext);
    
    // Embed the enhanced question
    const queryEmbedding = await getEmbedding(enhancedQuestion);
    console.log('[CHAT] Query embedding generated for enhanced question.');

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

    // Create enhanced prompt with better date handling
    const prompt = createEnhancedPrompt(question, context, dateContext);
    console.log('[CHAT] Enhanced prompt created with date context.');
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