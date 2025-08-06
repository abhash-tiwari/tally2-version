const TallyData = require('../models/TallyData');
const { getEmbedding } = require('../utils/embedding');
const { findMostSimilarChunks } = require('../utils/vectorSearch');
const { preprocessQuery, extractDateContext, createEnhancedPrompt } = require('../utils/queryPreprocessor');
const { getUserIdFromRequest } = require('../utils/userIdentifier');
const axios = require('axios');

exports.chat = async (req, res) => {
  try {
    const { question } = req.body;
    const userId = getUserIdFromRequest(req);
    
    console.log('[CHAT] Received question:', question, 'for user:', userId);
    if (!question) return res.status(400).json({ error: 'Missing question' });

    // Get ALL data for this user across all uploads
    // First try to find data with userId (new format)
    let userTallyData = await TallyData.find({ userId }).sort({ createdAt: -1 });
    
    // If no data found with userId, try to find any data (old format for backward compatibility)
    if (!userTallyData || userTallyData.length === 0) {
      console.log('[CHAT] No data found with userId:', userId, '- checking for any existing data...');
      userTallyData = await TallyData.find({}).sort({ createdAt: -1 }).limit(10); // Get recent uploads
      
      if (!userTallyData || userTallyData.length === 0) {
        console.log('[CHAT] No data found at all');
        return res.status(404).json({ error: 'No uploaded data found. Please upload some Tally files first.' });
      }
      
      console.log('[CHAT] Found', userTallyData.length, 'files from old format - using for backward compatibility');
    }
    
    // Combine all data chunks from all user uploads
    const allDataChunks = [];
    let totalFiles = 0;
    userTallyData.forEach(tallyDoc => {
      totalFiles++;
      tallyDoc.dataChunks.forEach(chunk => {
        allDataChunks.push({
          ...chunk.toObject(),
          fileName: tallyDoc.originalFileName,
          uploadedAt: tallyDoc.uploadedAt
        });
      });
    });
    
    console.log('[CHAT] User has', totalFiles, 'uploaded files with', allDataChunks.length, 'total data chunks');
    console.log('[CHAT] Files:', userTallyData.map(d => d.originalFileName).join(', '));
    
    if (allDataChunks.length > 0) {
      console.log('[CHAT] Example dataChunk:', allDataChunks[0]);
    }

    // Preprocess the question for better matching
    const enhancedQuestion = preprocessQuery(question);
    const dateContext = extractDateContext(question);
    console.log('[CHAT] Date context detected:', dateContext);
    
    // Embed the enhanced question
    const queryEmbedding = await getEmbedding(enhancedQuestion);
    console.log('[CHAT] Query embedding generated for enhanced question.');

    // Find most relevant data chunks across ALL user data
    const topChunks = findMostSimilarChunks(queryEmbedding, allDataChunks, 10); // Increase to 10 for better context
    console.log('[CHAT] Raw topChunks:', topChunks);
    console.log('[CHAT] Top chunks selected for context (from all user files):');
    topChunks.forEach((c, i) => {
     const content = c.content || (c._doc && c._doc.content);
     const fileName = c.fileName || 'Unknown file';
    if (typeof content === 'string') {
      console.log(`  Chunk ${i+1} [${fileName}]: ${content.substring(0, 100)}...`);
    } else {
      console.log(`  Chunk ${i+1} [${fileName}]: [No content]`, c);
      }
 });

    // Build context for OpenAI with file information
    const context = topChunks.map(chunk => {
      const content = chunk.content || (chunk._doc && chunk._doc.content) || '';
      const fileName = chunk.fileName || 'Unknown file';
      return `[From: ${fileName}]\n${content}`;
    }).join('\n\n');

    // Create enhanced prompt with better date handling and multi-file context
    const enhancedPrompt = createEnhancedPrompt(question, context, dateContext);
    const multiFilePrompt = `You are analyzing data from ${totalFiles} uploaded file(s): ${userTallyData.map(d => d.originalFileName).join(', ')}.

${enhancedPrompt}`;
    
    console.log('[CHAT] Enhanced prompt created with multi-file context for', totalFiles, 'files.');
    console.log('[CHAT] Calling OpenAI API...');

    // Call OpenAI API using axios
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant for Tally data analysis. You can analyze data from multiple uploaded files.' },
          { role: 'user', content: multiFilePrompt }
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