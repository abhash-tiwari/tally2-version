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
const { getEmbedding } = require('../utils/embedding');
const TallyData = require('../models/TallyData');
const { v4: uuidv4 } = require('uuid');

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    console.log('[UPLOAD] File received:', file.originalname, 'size:', file.size);

    const parsedData = await parseFile(file);
    console.log('[UPLOAD] File parsed. Type:', typeof parsedData);

    // Convert to one string regardless of input type
    let singleChunk = '';

    if (Array.isArray(parsedData)) {
      // Excel or ZIP
      parsedData.forEach(sheet => {
        if (typeof sheet === 'string') {
          singleChunk += sheet + '\n';
        } else if (sheet.data) {
          sheet.data.forEach(row => {
            singleChunk += row.join(' | ') + '\n';
          });
        }
      });
    } else if (typeof parsedData === 'string') {
      // PDF text
      singleChunk = parsedData;
    } else if (typeof parsedData === 'object') {
      const envelope = parsedData.ENVELOPE;

      // Support both old (nested) and new (flat) Tally XML formats
      if (envelope?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE) {
        const messages = envelope.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE;
        messages.forEach(msg => {
          if (msg.LEDGER) {
            const l = msg.LEDGER;
            singleChunk += `Ledger: ${l.NAME} | Parent: ${l.PARENT} | OB: ${l.OPENINGBALANCE} | CB: ${l.CLOSINGBALANCE}\n`;
          }
          if (msg.VOUCHER) {
            const v = msg.VOUCHER;
            singleChunk += `Voucher: ${v.DATE} | Type: ${v.VOUCHERTYPENAME} | Narration: ${v.NARRATION} | Amount: ${v.AMOUNT}\n`;
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
          singleChunk += `Voucher: ${dates[i] || '-'} | Type: ${types[i] || '-'} | Account: ${accounts[i] || '-'} | Dr: ${drAmts[i] || '-'} | Cr: ${crAmts[i] || '-'} | Narration: ${narrations[i] || '-'}\n`;
        }
      }
    }

    if (!singleChunk.trim()) {
      console.log('[UPLOAD] No data extracted for embedding.');
      return res.status(400).json({ error: 'No content extracted from file' });
    }

    // Get embedding
    const embedding = await getEmbedding(singleChunk);
    const sessionId = uuidv4();

    const tallyData = new TallyData({
      sessionId,
      originalFileName: file.originalname,
      dataChunks: [
        {
          content: singleChunk,
          embedding
        }
      ]
    });

    await tallyData.save();
    console.log('[UPLOAD] Data saved to MongoDB. Session ID:', sessionId);

    res.json({ sessionId });
  } catch (err) {
    console.error('[UPLOAD] Error:', err);
    res.status(500).json({ error: 'File processing failed' });
  }
};
