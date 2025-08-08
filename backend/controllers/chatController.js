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

// Build a focused keyword list based on the query and detected type
function buildQueryKeywords(userQuestion, queryType) {
  const base = [
    // Common financial terms
    'voucher', 'narration', 'account', 'ledger', 'bank', 'ltd', 'limited'
  ];

  if (queryType === 'loan') {
    base.push(
      'loan', 'loans', 'secured loan', 'unsecured loan', 'od', 'overdraft',
      'bank loan', 'interest on loan', 'cc account', 'borrowing', 'finance',
      'icici', 'kotak', 'indusind', 'hdfc', 'sbi'
    );
  } else if (queryType === 'sales') {
    base.push('sale', 'sales', 'igst', 'cgst', 'sgst', 'invoice');
  } else if (queryType === 'purchase') {
    base.push('purchase', 'purc', 'supplier', 'grn', 'igst', 'cgst', 'sgst');
  } else if (queryType === 'expense') {
    base.push('expense', 'expenses', 'rent', 'salary', 'bank charges', 'fees');
  } else if (queryType === 'receipt') {
    base.push('receipt', 'rcpt', 'income');
  }

  // Add significant words from the question (simple split, keep words >= 3 chars)
  const extras = String(userQuestion)
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter(w => w && w.length >= 3 && !base.includes(w));

  return Array.from(new Set([...base, ...extras]));
}

// Condense a large chunk to keep only relevant lines and a bit of surrounding context
function condenseContentByKeywords(content, keywords, options = {}) {
  if (!content || typeof content !== 'string') return '';
  const {
    maxLines = 120,
    linesBefore = 0,
    linesAfter = 0,
    maxCharsFallback = 800
  } = options;

  const lowerKeywords = keywords.map(k => k.toLowerCase());
  const lines = content.split(/\r?\n/);
  const picked = new Set();

  function lineMatches(line) {
    const lower = line.toLowerCase();
    return lowerKeywords.some(k => k && lower.includes(k));
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (lineMatches(lines[i])) {
      const start = Math.max(0, i - linesBefore);
      const end = Math.min(lines.length - 1, i + linesAfter);
      for (let j = start; j <= end; j += 1) {
        picked.add(j);
      }
    }
    if (picked.size >= maxLines) break;
  }

  if (picked.size === 0) {
    // No matches found. Return a small head of the content as fallback.
    return lines.slice(0, Math.min(lines.length, Math.ceil(maxCharsFallback / 80))).join('\n').slice(0, maxCharsFallback);
  }

  const condensed = Array.from(picked).sort((a, b) => a - b).map(idx => lines[idx]);
  const result = condensed.join('\n');
  // Safety trim to avoid mega chunks
  return result.length > maxCharsFallback * 4 ? result.slice(0, maxCharsFallback * 4) : result;
}

exports.chat = async (req, res) => {
  try {
    const { question, selectedFiles } = req.body;
    const userId = req.user.userId;
    
    console.log('[CHAT] Authenticated user:', req.user.email, 'asking:', question);
    console.log('[CHAT] Received question:', question, 'for user:', userId);
    console.log('[CHAT] Selected files:', selectedFiles);
    if (!question) return res.status(400).json({ error: 'Missing question' });

    // Get data for this specific authenticated user only
    let userTallyData;
    if (selectedFiles && selectedFiles.length > 0) {
      // Filter by selected files
      userTallyData = await TallyData.find({ 
        userId, 
        originalFileName: { $in: selectedFiles }
      }).sort({ createdAt: -1 });
      console.log('[CHAT] Filtering by selected files:', selectedFiles);
    } else {
      // Get all files (default behavior)
      userTallyData = await TallyData.find({ userId }).sort({ createdAt: -1 });
      console.log('[CHAT] Using all uploaded files');
    }
    
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
    const topChunks = findMostSimilarChunks(queryEmbedding, dateFilteredChunks, question, 20); // Get more candidates first
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
    
    // Smart chunk selection: prioritize by relevance score
    const sortedChunks = combinedChunks.sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA; // Higher scores first
    });
    
    // Limit total chunks to prevent token limit issues (first pass)
    const maxChunks = 10; // tighter cap
    const limitedChunks = sortedChunks.slice(0, maxChunks);
    
    console.log('[CHAT] Smart chunk selection - Top scores:', limitedChunks.map(c => c.score?.toFixed(3)).join(', '));
    
    console.log('[CHAT] Combined chunks for context:', combinedChunks.length, '-> Limited to:', limitedChunks.length);
    console.log('[CHAT] Top chunks selected for context (from all user files):');
    limitedChunks.slice(0, 5).forEach((c, i) => {
     const content = c.content || (c._doc && c._doc.content);
     const fileName = c.fileName || 'Unknown file';
    if (typeof content === 'string') {
      console.log(`  Chunk ${i+1} [${fileName}]: ${content.substring(0, 100)}...`);
    } else {
      console.log(`  Chunk ${i+1} [${fileName}]: [No content]`, c);
      }
 });
    
    // Log which files are being used in the response
    const filesUsed = [...new Set(limitedChunks.map(c => c.fileName))];
    console.log('[CHAT] Files being used in response:', filesUsed.join(', '));

    // Condense content per chunk based on query type/keywords
    const queryKeywords = buildQueryKeywords(question, queryType);
    const condensedChunks = limitedChunks.map((chunk) => {
      const content = chunk.content || (chunk._doc && chunk._doc.content) || '';
      const condensed = condenseContentByKeywords(content, queryKeywords, {
        maxLines: 120,
        linesBefore: 0,
        linesAfter: 0,
        maxCharsFallback: 1200
      });
      return { ...chunk, condensed };
    });

    // Build enhanced context using condensed content and enforce a global size cap
    const MAX_CONTEXT_CHARS = 16000; // global cap
    let running = '';
    let countIncluded = 0;
    for (let i = 0; i < condensedChunks.length; i += 1) {
      const chunk = condensedChunks[i];
      const fileName = chunk.fileName || 'Unknown file';
      const score = chunk.score ? ` (relevance: ${chunk.score.toFixed(3)})` : '';
      const piece = `[CHUNK ${i + 1} - From: ${fileName}${score}]\n${chunk.condensed}\n\n`;
      if ((running.length + piece.length) > MAX_CONTEXT_CHARS) break;
      running += piece;
      countIncluded += 1;
    }
    const context = running;
    console.log('[CHAT] Condensed context uses', countIncluded, 'chunks, chars:', context.length);

    // Add validation context
    const validationContext = `
DATA VALIDATION SUMMARY:
- Total vouchers available: ${dataSummary.totalVouchers}
- Voucher types found: ${Object.keys(dataSummary.voucherTypes).join(', ')}
- Date range: ${dataSummary.dateRange.min ? dataSummary.dateRange.min.toDateString() : 'N/A'} to ${dataSummary.dateRange.max ? dataSummary.dateRange.max.toDateString() : 'N/A'}
- Total debit amount: ${dataSummary.totalDebit.toLocaleString()}
- Total credit amount: ${dataSummary.totalCredit.toLocaleString()}
`;

    // Estimate token usage to prevent overflow
    const contextLength = context.length;
    const validationLength = validationContext.length;
    const questionLength = question.length;
    const totalEstimatedTokens = Math.ceil((contextLength + validationLength + questionLength) / 4); // Rough estimation
    
    console.log('[CHAT] Token estimation - Context:', contextLength, 'chars, Validation:', validationLength, 'chars, Question:', questionLength, 'chars');
    console.log('[CHAT] Estimated total tokens:', totalEstimatedTokens);
    
    // If estimated tokens are too high, make a second-pass tighter condensation
    let finalContext, finalValidationContext;
    if (totalEstimatedTokens > 6000) { // Conservative limit
      const MAX_TIGHT_CONTEXT_CHARS = 9000;
      let tight = '';
      let used = 0;
      for (let i = 0; i < condensedChunks.length; i += 1) {
        const chunk = condensedChunks[i];
        const fileName = chunk.fileName || 'Unknown file';
        const score = chunk.score ? ` (relevance: ${chunk.score.toFixed(3)})` : '';
        // Further trim each condensed block
        const trimmed = (chunk.condensed || '').slice(0, 1200);
        const piece = `[CHUNK ${i + 1} - From: ${fileName}${score}]\n${trimmed}\n\n`;
        if ((tight.length + piece.length) > MAX_TIGHT_CONTEXT_CHARS) break;
        tight += piece;
        used += 1;
      }
      finalContext = tight;
      finalValidationContext = validationContext;
      console.log('[CHAT] Tight condensation used chunks:', used, 'chars:', finalContext.length);
    } else {
      finalContext = context;
      finalValidationContext = validationContext;
    }

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
    const enhancedPrompt = createEnhancedPrompt(question + extraInstructions, finalContext + finalValidationContext, dateContext);
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