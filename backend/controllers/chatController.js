const TallyData = require('../models/TallyData');
const { getEmbedding } = require('../utils/embedding');
const { findMostSimilarChunks, findKeywordMatches } = require('../utils/vectorSearch');
const { preprocessQuery, extractDateContext, createEnhancedPrompt } = require('../utils/queryPreprocessor');
const { filterChunksByDate } = require('../utils/dateFilter');
const { createDataSummary, countVouchersByTypeAndDate } = require('../utils/dataValidator');
const { authenticateToken } = require('../routes/auth');
const axios = require('axios');

const QUERY_TYPE_KEYWORDS = {
  loan: [
    'loan', 'od', 'overdraft', 'secured loan', 'unsecured loan', 'borrowing', 'debt', 'credit facility', 'bank loan', 'cc account', 'bill discounting'
  ],
  sales: [
    'sale', 'sales', 'sales account', 'sales ledger', 'sales-igst', 'sales local', 'sales lut/bond'
  ],
  purchase: [
    'purchase', 'purc', 'purchases', 'purchase account', 'purchase ledger', 'import purchase', 'export purchase'
  ],
  expense: [
    'expense', 'expenses', 'professional fees', 'rent', 'salary', 'bank charges', 'utility', 'travel', 'food', 'misc. expenses', 'mobile expenses', 'telephone expense', 'interest on loan', 'interest expense'
  ],
  receipt: [
    'receipt', 'rcpt', 'receipts', 'received', 'income', 'direct incomes', 'indirect incomes'
  ]
};

function detectQueryType(query) {
  const lower = query.toLowerCase();
  for (const [type, keywords] of Object.entries(QUERY_TYPE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      return type;
    }
  }
  return null;
}

function filterChunksByType(chunks, type) {
  if (!type) return chunks;
  const keywords = QUERY_TYPE_KEYWORDS[type];
  return chunks.filter(chunk => {
    const content = (chunk.content || '').toLowerCase();
    return keywords.some(k => content.includes(k));
  });
}

exports.chat = async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user.userId;
    
    console.log('[CHAT] Authenticated user:', req.user.email, 'asking:', question);
    console.log('[CHAT] Received question:', question, 'for user:', userId);
    if (!question) return res.status(400).json({ error: 'Missing question' });

    // Get ALL data for this specific authenticated user only
    let userTallyData = await TallyData.find({ userId }).sort({ createdAt: -1 });
    
    // SECURITY: Only search user's own data - no fallback to all data
    if (!userTallyData || userTallyData.length === 0) {
      console.log('[CHAT] No data found for authenticated user:', userId);
      console.log('[CHAT] User must upload files first');
      return res.status(404).json({ 
        error: 'No uploaded data found for your account. Please upload some Tally files first to start chatting.',
        userSpecific: true
      });
    }
    
    console.log('[CHAT] Found', userTallyData.length, 'files for authenticated user:', userId);
    
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
    
    // Detect query type and filter data chunks accordingly
    const queryType = detectQueryType(question);
    const filteredChunks = filterChunksByType(allDataChunks, queryType);
    if (filteredChunks.length === 0) {
      console.log('[CHAT] No relevant data found for query type:', queryType);
      return res.status(404).json({ error: 'No relevant data found for your query type.' });
    }

    // Apply date filtering if date context is detected
    let dateFilteredChunks = filteredChunks;
    if (dateContext.isDateSpecific) {
      dateFilteredChunks = filterChunksByDate(filteredChunks, dateContext);
      console.log('[CHAT] Date filtering applied. Chunks before:', filteredChunks.length, 'after:', dateFilteredChunks.length);
      
      if (dateFilteredChunks.length === 0) {
        console.log('[CHAT] No data found for specified date range');
        
        // Provide more detailed debugging information
        const allDates = [];
        filteredChunks.forEach(chunk => {
          const content = chunk.content || '';
          const dateMatches = content.match(/\d{1,2}-[A-Za-z]{3}-\d{2}/g) || [];
          allDates.push(...dateMatches);
        });
        
        console.log('[CHAT] Available dates in data:', allDates.slice(0, 10)); // Show first 10 dates
        console.log('[CHAT] Requested date range:', dateContext.months.join(', '), dateContext.years.join(', '));
        
        return res.status(404).json({ 
          error: `No data found for ${dateContext.months.join(', ')} ${dateContext.years.join(', ')}. Available data appears to be from different months. Please check your date range or upload data for this period.`,
          availableDates: allDates.slice(0, 10),
          requestedRange: `${dateContext.months.join(', ')} ${dateContext.years.join(', ')}`
        });
      }
    }
    
    // Create data summary for validation
    const dataSummary = createDataSummary(dateFilteredChunks);
    console.log('[CHAT] Data summary:', {
      totalVouchers: dataSummary.totalVouchers,
      voucherTypes: Object.keys(dataSummary.voucherTypes),
      dateRange: dataSummary.dateRange
    });
    
    // Embed the enhanced question
    const queryEmbedding = await getEmbedding(enhancedQuestion);
    console.log('[CHAT] Query embedding generated for enhanced question.');

    // Find most relevant data chunks using enhanced vector search
    const topChunks = findMostSimilarChunks(queryEmbedding, dateFilteredChunks, question, 20); // Increased to 20 for better context
    console.log('[CHAT] Enhanced vector search completed. Found', topChunks.length, 'relevant chunks');
    
    // Also find keyword matches as backup
    const keywordMatches = findKeywordMatches(dateFilteredChunks, question);
    console.log('[CHAT] Keyword search found', keywordMatches.length, 'matching chunks');
    
    // Combine and deduplicate chunks (prefer vector search results)
    const combinedChunks = [...topChunks];
    keywordMatches.forEach(keywordChunk => {
      if (!combinedChunks.find(c => c._id?.toString() === keywordChunk._id?.toString())) {
        combinedChunks.push(keywordChunk);
      }
    });
    
    console.log('[CHAT] Combined chunks for context:', combinedChunks.length);
    console.log('[CHAT] Top chunks selected for context (from all user files):');
    combinedChunks.slice(0, 5).forEach((c, i) => {
     const content = c.content || (c._doc && c._doc.content);
     const fileName = c.fileName || 'Unknown file';
    if (typeof content === 'string') {
      console.log(`  Chunk ${i+1} [${fileName}]: ${content.substring(0, 100)}...`);
    } else {
      console.log(`  Chunk ${i+1} [${fileName}]: [No content]`, c);
      }
 });

    // Build enhanced context with better structure and validation info
    const context = combinedChunks.map((chunk, index) => {
      const content = chunk.content || (chunk._doc && c._doc.content) || '';
      const fileName = chunk.fileName || 'Unknown file';
      const score = chunk.score ? ` (relevance: ${chunk.score.toFixed(3)})` : '';
      return `[CHUNK ${index + 1} - From: ${fileName}${score}]\n${content}`;
    }).join('\n\n');

    // Add validation context
    const validationContext = `
DATA VALIDATION SUMMARY:
- Total vouchers available: ${dataSummary.totalVouchers}
- Voucher types found: ${Object.keys(dataSummary.voucherTypes).join(', ')}
- Date range: ${dataSummary.dateRange.min ? dataSummary.dateRange.min.toDateString() : 'N/A'} to ${dataSummary.dateRange.max ? dataSummary.dateRange.max.toDateString() : 'N/A'}
- Total debit amount: ${dataSummary.totalDebit.toLocaleString()}
- Total credit amount: ${dataSummary.totalCredit.toLocaleString()}
`;

    // Enhance prompt with query-type-specific instructions
    let extraInstructions = '';
    if (queryType === 'loan') {
      extraInstructions = '\nIMPORTANT: Only include transactions where the account or narration contains the word "Loan", "OD", "Bank Loan", "Secured Loan", or "Unsecured Loan". Ignore regular payments, receipts, and expenses. Deduplicate loans by account and counterparty. Do not double-count the same loan.';
    } else if (queryType === 'sales') {
      extraInstructions = '\nIMPORTANT: Only consider entries where the account or narration contains "Sale" or "Sales". Ignore unrelated transactions.';
    } else if (queryType === 'purchase') {
      extraInstructions = '\nIMPORTANT: Only include entries with "Purchase" or "Purc" in the account or narration. Ignore sales, receipts, and expenses.';
    } else if (queryType === 'expense') {
      extraInstructions = '\nIMPORTANT: Only include entries with "Expense" or related terms in the account or narration. Ignore purchases, sales, and receipts.';
    } else if (queryType === 'receipt') {
      extraInstructions = '\nIMPORTANT: Only include entries with "Receipt" or "Rcpt" in the account or narration. Ignore unrelated transactions.';
    }

    // Add date-specific instructions if date context is detected
    if (dateContext.isDateSpecific) {
      const dateFilter = dateContext.months.length > 0 || dateContext.years.length > 0;
      if (dateFilter) {
        extraInstructions += `\nCRITICAL DATE FILTER: You are ONLY allowed to analyze data from ${dateContext.months.join(', ')} ${dateContext.years.join(', ')}. Ignore ALL data from other periods. When counting vouchers, verify each date matches the requested period.`;
      }
    }

    // Create enhanced prompt with better date handling and multi-file context
    const enhancedPrompt = createEnhancedPrompt(question + extraInstructions, context + validationContext, dateContext);
    const multiFilePrompt = `You are analyzing data from ${totalFiles} uploaded file(s): ${userTallyData.map(d => d.originalFileName).join(', ')}.\n\n${enhancedPrompt}`;
    
    console.log('[CHAT] Enhanced prompt created with multi-file context for', totalFiles, 'files.');
    console.log('[CHAT] Date context:', dateContext);
    console.log('[CHAT] Calling OpenAI API...');

    // Call OpenAI API using axios
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: `You are a precise Tally data analysis assistant. Follow these CRITICAL rules:

1. DATE FILTERING: When a specific date/month/year is mentioned, ONLY analyze data from that exact period
2. VOUCHER COUNTING: Each "Voucher:" line represents one voucher - count them exactly once
3. ACCURACY: Never include data from wrong periods or make assumptions
4. VERIFICATION: Always verify dates match the requested period before counting
5. CLARITY: State exactly which date range you analyzed and what you found
6. CONSISTENCY: Use the same counting method for similar queries
7. CONTEXT: Consider all provided chunks when answering, not just the first few
8. VALIDATION: Use the provided data summary to verify your analysis

For date-specific queries like "sales vouchers in July 2025", ONLY count vouchers with dates in July 2025.` 
          },
          { role: 'user', content: multiFilePrompt }
        ],
        max_tokens: 1024, // Increased for more detailed responses
        temperature: 0.1 // Reduced for more consistent responses
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