// const { parseFile } = require('../utils/parseFile');
// const { getEmbedding } = require('../utils/embedding');
// const TallyData = require('../models/TallyData');
// const { v4: uuidv4 } = require('uuid');

// exports.uploadFile = async (req, res) => {
//   try {
//     const file = req.file;
//     if (!file) return res.status(400).json({ error: 'No file uploaded' });
//     console.log('[UPLOAD] File received:', file.originalname, 'size:', file.size);

//     // Parse file
//     const parsedData = await parseFile(file);
//     console.log('[UPLOAD] File parsed. Type:', typeof parsedData);

//     if (Array.isArray(parsedData)) {
//       console.log('[UPLOAD] Sample:', JSON.stringify(parsedData[0], null, 2));
//     } else if (typeof parsedData === 'string') {
//       console.log('[UPLOAD] Sample:', parsedData.substring(0, 200));
//     } else {
//       console.log('[UPLOAD] Sample:', JSON.stringify(parsedData, null, 2));
//     }

//     // Flatten and chunk data for embeddings
//     let chunks = [];

//     if (Array.isArray(parsedData)) {
//       // Excel / ZIP
//       parsedData.forEach(sheet => {
//         if (typeof sheet === 'string') {
//           chunks.push(sheet);
//         } else if (sheet.data) {
//           sheet.data.forEach(row => {
//             chunks.push(row.join(' | '));
//           });
//         }
//       });
//     } else if (typeof parsedData === 'string') {
//       // PDF
//       chunks = parsedData.match(/(.|[\r\n]){1,1000}/g);
//     } else if (typeof parsedData === 'object') {
//       const envelope = parsedData.ENVELOPE;

//       if (envelope?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE) {
//         // Nested XML structure (old)
//         const messages = envelope.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE;
//         messages.forEach(msg => {
//           if (msg.LEDGER) {
//             const l = msg.LEDGER;
//             chunks.push(`Ledger: ${l.NAME} | Parent: ${l.PARENT} | OB: ${l.OPENINGBALANCE} | CB: ${l.CLOSINGBALANCE}`);
//           }
//           if (msg.VOUCHER) {
//             const v = msg.VOUCHER;
//             chunks.push(`Voucher: ${v.DATE} | Type: ${v.VOUCHERTYPENAME} | Narration: ${v.NARRATION} | Amount: ${v.AMOUNT}`);
//           }
//         });
//       } else if (envelope?.DSPVCHDATE && envelope.DSPVCHDATE.length) {
//         // Flat XML structure (new)
//         const dates = envelope.DSPVCHDATE || [];
//         const types = envelope.DSPVCHTYPE || [];
//         const accounts = envelope.DSPVCHLEDACCOUNT || [];
//         const drAmts = envelope.DSPVCHDRAMT || [];
//         const crAmts = envelope.DSPVCHCRAMT || [];
//         const narrations = envelope.DSPEXPLVCHNUMBER || [];

//         for (let i = 0; i < dates.length; i++) {
//           const line = `Voucher: ${dates[i] || '-'} | Type: ${types[i] || '-'} | Account: ${accounts[i] || '-'} | Dr: ${drAmts[i] || '-'} | Cr: ${crAmts[i] || '-'} | Narration: ${narrations[i] || '-'}`;
//           chunks.push(line);
//         }
//       }
//     }

//     console.log('[UPLOAD] Chunks created:', chunks.length, 'Sample chunk:', chunks[0]);

//     // Get embeddings
//     const dataChunks = [];
//     for (let i = 0; i < chunks.length; i++) {
//       const chunk = chunks[i];
//       if (chunk.trim().length > 0) {
//         const embedding = await getEmbedding(chunk);
//         dataChunks.push({ content: chunk, embedding });
//         if (i === 0) {
//           console.log('[UPLOAD] First embedding generated for chunk:', chunk.substring(0, 100));
//         }
//       }
//     }

//     console.log('[UPLOAD] Embeddings generated for all chunks. Total:', dataChunks.length);

//     // Save to Mongo
//     const sessionId = uuidv4();
//     const tallyData = new TallyData({
//       sessionId,
//       originalFileName: file.originalname,
//       dataChunks,
//     });

//     await tallyData.save();
//     console.log('[UPLOAD] Data saved to MongoDB. Session ID:', sessionId);

//     res.json({ sessionId });
//   } catch (err) {
//     console.error('[UPLOAD] Error:', err);
//     res.status(500).json({ error: 'File processing failed' });
//   }
// };


const { parseFile } = require('../utils/parseFile');
const { v4: uuidv4 } = require('uuid');
const TallyData = require('../models/TallyData');
const User = require('../models/User');
const { getEmbedding } = require('../utils/embedding');
const { chunkTallyData, getChunkingSummary } = require('../utils/dataChunker');
const { authenticateToken } = require('../routes/auth');

// Helper: extract a month key (YYYY-MM) from a line of text
function extractMonthKeyFromLine(line) {
  if (!line) return null;

  // Try common date patterns that appear in Tally exports
  // 1) dd-MMM-yy or dd-MMM-yyyy e.g., 11-Mar-25 or 11-Mar-2025
  const m1 = line.match(/\b(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\b/);
  if (m1) {
    const [_, d, monAbbrRaw, yRaw] = m1;
    const monAbbr = monAbbrRaw.slice(0, 3).toLowerCase();
    const months = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    const m = months[monAbbr];
    if (m) {
      let y = parseInt(yRaw, 10);
      if (yRaw.length === 2) {
        // Pivot: 00-69 => 2000-2069, 70-99 => 1970-1999
        y = y < 70 ? 2000 + y : 1900 + y;
      }
      return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`;
    }
  }

  // 2) yyyyMMdd e.g., 20250311 (Tally XML date)
  const m2 = line.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (m2) {
    const y = m2[1];
    const mo = m2[2];
    return `${y}-${mo}`;
  }

  // 3) ISO yyyy-MM-dd
  const m3 = line.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (m3) {
    const y = m3[1];
    const mo = m3[2];
    return `${y}-${mo}`;
  }

  return null;
}

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    console.log('[UPLOAD] File received:', file.originalname, 'size:', file.size);

    const parsedData = await parseFile(file);
    console.log('[UPLOAD] File parsed. Type:', typeof parsedData);

    // Build a list of normalized lines we can group by month later
    const lines = [];

    if (Array.isArray(parsedData)) {
      // Excel or ZIP
      parsedData.forEach(sheet => {
        if (typeof sheet === 'string') {
          // Split to lines to allow month grouping
          String(sheet).split(/\r?\n/).forEach(l => { if (l && l.trim()) lines.push(l); });
        } else if (sheet.data) {
          sheet.data.forEach(row => {
            const l = row.join(' | ');
            if (l && l.trim()) lines.push(l);
          });
        }
      });
    } else if (typeof parsedData === 'string') {
      // PDF text -> lines
      String(parsedData).split(/\r?\n/).forEach(l => { if (l && l.trim()) lines.push(l); });
    } else if (typeof parsedData === 'object') {
      const envelope = parsedData.ENVELOPE;

      // Support both old (nested) and new (flat) Tally XML formats
      if (envelope?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE) {
        const messages = envelope.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE;
        messages.forEach(msg => {
          if (msg.LEDGER) {
            const l = msg.LEDGER;
            lines.push(`Ledger: ${l.NAME} | Parent: ${l.PARENT} | OB: ${l.OPENINGBALANCE} | CB: ${l.CLOSINGBALANCE}`);
          }
          if (msg.VOUCHER) {
            const v = msg.VOUCHER;
            lines.push(`Voucher: ${v.DATE} | Type: ${v.VOUCHERTYPENAME} | Narration: ${v.NARRATION} | Amount: ${v.AMOUNT}`);
          }
        });
      } else if (envelope?.DSPVCHDATE) {
        const dates = envelope.DSPVCHDATE || [];
        const types = envelope.DSPVCHTYPE || [];
        const accounts = envelope.DSPVCHLEDACCOUNT || [];
        const drAmts = envelope.DSPVCHDRAMT || [];
        const crAmts = envelope.DSPVCHCRAMT || [];
        const narrations = envelope.DSPEXPLVCHNUMBER || [];

        for (let i = 0; i < dates.length; i++) {
          lines.push(`Voucher: ${dates[i] || '-'} | Type: ${types[i] || '-'} | Account: ${accounts[i] || '-'} | Dr: ${drAmts[i] || '-'} | Cr: ${crAmts[i] || '-'} | Narration: ${narrations[i] || '-'}`);
        }
      }
    }

    if (!lines.length) {
      console.log('[UPLOAD] No data extracted for embedding.');
      return res.status(400).json({ error: 'No content extracted from file' });
    }

    // Group lines by monthKey
    const groups = new Map(); // monthKey => string[]
    let lastMonthKey = null;
    for (const l of lines) {
      const detected = extractMonthKeyFromLine(l);
      if (detected) lastMonthKey = detected;
      const mk = detected || lastMonthKey || 'unknown';
      if (!groups.has(mk)) groups.set(mk, []);
      groups.get(mk).push(l);
    }

    // If only one actual month was detected, merge any 'unknown' lines into it
    const nonUnknownMonths = Array.from(groups.keys()).filter(k => k !== 'unknown');
    if (groups.has('unknown') && nonUnknownMonths.length === 1) {
      const sole = nonUnknownMonths[0];
      const unknownLines = groups.get('unknown') || [];
      const merged = groups.get(sole) || [];
      groups.set(sole, merged.concat(unknownLines));
      groups.delete('unknown');
      console.log('[UPLOAD] Merged date-less lines into month:', sole, 'Count:', unknownLines.length);
    }

    // For each month group, create chunks within that month
    const allMonthChunks = [];
    for (const [mk, arr] of groups.entries()) {
      const monthText = arr.join('\n');
      // If the month's content is small, keep it as a single chunk to avoid unnecessary splits
      const SMALL_MONTH_CHAR_LIMIT = 12000; // ~3k tokens rough
      let monthChunks;
      if (monthText.length <= SMALL_MONTH_CHAR_LIMIT) {
        monthChunks = [monthText];
      } else {
        monthChunks = chunkTallyData(
          monthText,
          4000, // tokens
          3000, // words
          200,  // overlap tokens
          150   // overlap words
        );
      }
      // Attach monthKey to each content chunk
      monthChunks.forEach(c => {
        allMonthChunks.push({ content: c, monthKey: mk === 'unknown' ? undefined : mk });
      });
    }

    // Build chunking summary similar to previous, but aggregated
    const chunkingSummary = getChunkingSummary(allMonthChunks.map(c => c.content), true);
    console.log('[UPLOAD] Created', allMonthChunks.length, 'chunks across', groups.size, 'month groups from file:', file.originalname);

    // Generate embeddings for each month-based chunk
    const chunksWithEmbeddings = [];
    const totalChunks = allMonthChunks.length;
    for (let i = 0; i < allMonthChunks.length; i++) {
      const { content, monthKey } = allMonthChunks[i];
      console.log(`[UPLOAD] Generating embedding for chunk ${i + 1}/${totalChunks}${monthKey ? ' [' + monthKey + ']' : ''}`);
      
      try {
        const embedding = await getEmbedding(content);
        chunksWithEmbeddings.push({
          content,
          embedding,
          chunkIndex: i + 1,
          totalChunks: totalChunks,
          monthKey
        });
      } catch (embeddingError) {
        console.error(`[UPLOAD] Failed to generate embedding for chunk ${i + 1}:`, embeddingError);
        // Continue with other chunks even if one fails
        chunksWithEmbeddings.push({
          content,
          embedding: [], // Empty embedding as fallback
          chunkIndex: i + 1,
          totalChunks: totalChunks,
          monthKey,
          embeddingError: true
        });
      }
    }

    // Get authenticated user ID from JWT token
    const userId = req.user.userId;
    const sessionId = uuidv4(); // Keep for backward compatibility
    
    console.log('[UPLOAD] Authenticated user:', req.user.email, 'uploading file:', file.originalname);

    const tallyData = new TallyData({
      userId,
      sessionId,
      originalFileName: file.originalname,
      dataChunks: chunksWithEmbeddings,
      userEmail: req.user.email // Add user email for reference
    });

    await tallyData.save();
    console.log('[UPLOAD] Data saved to MongoDB. User ID:', userId, 'Session ID:', sessionId);
    console.log('[UPLOAD] File:', file.originalname, 'processed into', chunksWithEmbeddings.length, 'month-based chunks');
    console.log('[UPLOAD] Total tokens:', chunkingSummary.totalTokens, 'Total words:', chunkingSummary.totalWords);

    // Return success with detailed info including overlap statistics
    const overlapInfo = chunkingSummary.overlapAnalysis ? 
      ` with ${chunkingSummary.overlapAnalysis.averageOverlapTokens} avg overlap tokens` : '';
    
    res.json({ 
      sessionId, // Keep for backward compatibility
      userId,
      userEmail: req.user.email,
      message: `File uploaded successfully! Processed into ${chunksWithEmbeddings.length} overlapping chunks${overlapInfo}. You can now chat about all your uploaded data!`,
      fileName: file.originalname,
      chunksCreated: chunksWithEmbeddings.length,
      totalTokens: chunkingSummary.totalTokens,
      totalWords: chunkingSummary.totalWords,
      hasOverlap: chunkingSummary.hasOverlap,
      overlapAnalysis: chunkingSummary.overlapAnalysis
    });
  } catch (err) {
    console.error('[UPLOAD] Error:', err);
    res.status(500).json({ error: 'File processing failed' });
  }
};

/**
 * Get all files uploaded by the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserFiles = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('[GET_FILES] Getting files for user:', req.user.email);

    // Get all files for the user, grouped by fileName
    console.log('[GET_FILES] Querying MongoDB for userId:', userId);
    
    // First, let's try a simple find to see if we get any data
    const allUserData = await TallyData.find({ userId: userId });
    console.log('[GET_FILES] Found', allUserData.length, 'total documents for user');
    
    if (allUserData.length === 0) {
      console.log('[GET_FILES] No data found for user, returning empty array');
      return res.json({ 
        files: [],
        totalFiles: 0,
        userEmail: req.user.email
      });
    }
    
    // Now try the aggregation
    try {
      const files = await TallyData.aggregate([
        { $match: { userId: userId } },
        { 
          $group: { 
            _id: '$originalFileName',
            fileId: { $first: '$_id' },
            fileName: { $first: '$originalFileName' },
            uploadedAt: { $first: '$createdAt' },
            totalChunks: { $sum: { $size: '$dataChunks' } },
            totalTokens: { 
              $sum: { 
                $reduce: {
                  input: '$dataChunks',
                  initialValue: 0,
                  in: { $add: ['$$value', { $strLenCP: '$$this.content' }] }
                }
              }
            }
          }
        },
        { $sort: { uploadedAt: -1 } }
      ]);

      console.log('[GET_FILES] Found', files.length, 'files for user:', req.user.email);
      
      res.json({ 
        files,
        totalFiles: files.length,
        userEmail: req.user.email
      });
    } catch (aggregationError) {
      console.error('[GET_FILES] Aggregation error:', aggregationError);
      
      // Fallback: return simple file list without aggregation
      const simpleFiles = allUserData.map(doc => ({
        fileId: doc._id,
        fileName: doc.originalFileName,
        uploadedAt: doc.createdAt,
        totalChunks: doc.dataChunks ? doc.dataChunks.length : 0,
        totalTokens: doc.dataChunks ? doc.dataChunks.reduce((sum, chunk) => sum + (chunk.content ? chunk.content.length : 0), 0) : 0
      }));
      
      console.log('[GET_FILES] Using fallback method, found', simpleFiles.length, 'files');
      
      res.json({ 
        files: simpleFiles,
        totalFiles: simpleFiles.length,
        userEmail: req.user.email
      });
    }
  } catch (err) {
    console.error('[GET_FILES] Error:', err);
    res.status(500).json({ error: 'Failed to get user files' });
  }
};
