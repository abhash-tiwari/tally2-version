const { parseFile } = require('../utils/parseFile');
const { getEmbedding } = require('../utils/embedding');
const TallyData = require('../models/TallyData');
const { v4: uuidv4 } = require('uuid');

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    console.log('[UPLOAD] File received:', file.originalname, 'size:', file.size);

    // Parse file
    const parsedData = await parseFile(file);
    console.log('[UPLOAD] File parsed. Type:', typeof parsedData, 'Sample:', Array.isArray(parsedData) ? JSON.stringify(parsedData[0]) : parsedData.substring(0, 200));

    // Flatten and chunk data for embeddings
    let chunks = [];
    if (Array.isArray(parsedData)) {
      parsedData.forEach(sheet => {
        if (typeof sheet === 'string') {
          chunks.push(sheet);
        } else if (sheet.data) {
          // Flatten rows to strings
          sheet.data.forEach(row => {
            chunks.push(row.join(' | '));
          });
        }
      });
    } else if (typeof parsedData === 'string') {
      // PDF text
      chunks = parsedData.match(/(.|[\r\n]){1,1000}/g); // Split into 1000-char chunks
    }
    console.log('[UPLOAD] Chunks created:', chunks.length, 'Sample chunk:', chunks[0]);

    // Get embeddings for each chunk
    const dataChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.trim().length > 0) {
        const embedding = await getEmbedding(chunk);
        dataChunks.push({ content: chunk, embedding });
        if (i === 0) console.log('[UPLOAD] First embedding generated for chunk:', chunk.substring(0, 100));
      }
    }
    console.log('[UPLOAD] Embeddings generated for all chunks. Total:', dataChunks.length);

    // Save to MongoDB
    const sessionId = uuidv4();
    const tallyData = new TallyData({
      sessionId,
      originalFileName: file.originalname,
      dataChunks,
    });
    await tallyData.save();
    console.log('[UPLOAD] Data saved to MongoDB. Session ID:', sessionId);

    res.json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'File processing failed' });
  }
};