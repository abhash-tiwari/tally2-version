const TallyData = require('../models/TallyData');
const PLData = require('../models/PLData');
const LedgerData = require('../models/LedgerData');
const { getEmbedding } = require('../utils/embedding');
const { findMostSimilarChunks, findKeywordMatches } = require('../utils/vectorSearch');
const { preprocessQuery, extractDateContext, createEnhancedPrompt } = require('../utils/queryPreprocessor');
const { filterChunksByDate } = require('../utils/dateFilter');
const { createDataSummary, countVouchersByTypeAndDate, extractInterestOnSecuredLoans } = require('../utils/dataValidator');
const { extractPurchaseEntries, extractBankSpecificEntries, validatePurchaseEntries, validateBankEntries } = require('../utils/purchaseBankDetector');
const { authenticateToken } = require('../routes/auth');
const axios = require('axios');

// Select OpenAI model via env with a safe default
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
console.log(`Using OpenAI model: ${OPENAI_MODEL}`);

// Dynamic expense keywords cache
let dynamicExpenseKeywords = [];
let lastKeywordUpdate = 0;
const KEYWORD_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fallback hardcoded keywords (used when no ledger data available)
const FALLBACK_EXPENSE_KEYWORDS = [
  // Common expense patterns
  'expense', 'charges', 'fees', 'cost', 'payment', 'rent', 'salary', 'interest',
  'insurance', 'travel', 'office', 'professional', 'freight', 'transport',
  'maintenance', 'repair', 'electricity', 'telephone', 'mobile', 'courier',
  'advertising', 'promotion', 'commission', 'brokerage', 'customs', 'duty',
  'depreciation', 'bonus', 'allowance', 'welfare', 'compliance', 'audit'
];

// Get dynamic expense keywords from user's ledger data
async function getDynamicExpenseKeywords(userId) {
  try {
    // Check cache first
    const now = Date.now();
    if (dynamicExpenseKeywords.length > 0 && (now - lastKeywordUpdate) < KEYWORD_CACHE_DURATION) {
      return dynamicExpenseKeywords;
    }

    console.log('[DYNAMIC_KEYWORDS] Fetching expense keywords for user:', userId);
    
    const ledgerData = await LedgerData.find({ userId });
    const keywords = new Set();
    
    ledgerData.forEach(data => {
      data.ledgers.forEach(ledger => {
        // Include ledgers from expense categories
        if (ledger.category && ledger.category.toLowerCase().includes('expense')) {
          ledger.keywords.forEach(keyword => keywords.add(keyword));
        }
        
        // Include ledgers with expense-related names
        const ledgerLower = ledger.name.toLowerCase();
        const expenseIndicators = ['expense', 'charges', 'fees', 'cost', 'payment', 'rent', 'salary', 'freight', 'transport'];
        
        if (expenseIndicators.some(indicator => ledgerLower.includes(indicator))) {
          ledger.keywords.forEach(keyword => keywords.add(keyword));
        }
      });
    });
    
    dynamicExpenseKeywords = Array.from(keywords);
    lastKeywordUpdate = now;
    
    console.log('[DYNAMIC_KEYWORDS] Found', dynamicExpenseKeywords.length, 'dynamic expense keywords');
    
    // If no dynamic keywords found, use fallback
    if (dynamicExpenseKeywords.length === 0) {
      console.log('[DYNAMIC_KEYWORDS] No ledger data found, using fallback keywords');
      return FALLBACK_EXPENSE_KEYWORDS;
    }
    
    return dynamicExpenseKeywords;
    
  } catch (error) {
    console.error('[DYNAMIC_KEYWORDS] Error fetching keywords:', error);
    return FALLBACK_EXPENSE_KEYWORDS;
  }
}

// Custom Duty specific keywords for dedicated handling
const CUSTOM_DUTY_KEYWORDS = [
  'Custom Duty', 'Indian Customs', 'Customs', 'Custom Duty- Rough Marble Blocks',
  'Penalty Custom', 'customs duty', 'custom duties'
];

// Extract major expenses from text content using dynamic keywords
async function extractMajorExpensesFromText(content, wantedMonthsSet, wantedYearsSet, userId) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  
  // Get dynamic expense keywords for this user
  const expenseKeywords = await getDynamicExpenseKeywords(userId);
  
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  
  console.log('[MAJOR_EXPENSE] Processing', lines.length, 'lines with', expenseKeywords.length, 'dynamic keywords');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Check if line contains any expense keywords
    const hasExpenseKeyword = expenseKeywords.some(keyword => 
      line.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (!hasExpenseKeyword) continue;
    
    // Extract date from line
    const dateMatch = dateRegex.exec(line);
    if (!dateMatch) continue;
    
    const currentDate = dateMatch[0];
    const monthAbbr = dateMatch[2].toLowerCase();
    const year = dateMatch[3];
    
    // Filter by wanted months and years
    if (wantedMonthsSet.size > 0 && !wantedMonthsSet.has(monthAbbr)) continue;
    if (wantedYearsSet.size > 0 && !wantedYearsSet.has(year)) continue;
    
    // Parse CSV fields to find account and debit amount
    // CSV Format: Date,"Account","","VoucherType",Amount1,Amount2,
    // Negative Amount1 = Debit (expense), Positive Amount2 = Credit
    const fields = line.split(',');
    let account = '';
    let debitAmount = 0;
    let isExpenseDebited = false;
    
    // Find the expense account name in field 1 (after date)
    if (fields.length >= 5) {
      const accountField = fields[1].replace(/^"|"$/g, '').trim();
      
      // Check if this account matches any expense keyword
      const matchedKeyword = expenseKeywords.find(keyword => 
        accountField.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (matchedKeyword) {
        account = accountField;
        
        // Check Amount1 field (field 4) for negative value (debit)
        const amount1Field = fields[4].replace(/^"|"$/g, '').trim();
        if (amount1Field && amount1Field.match(/^-[0-9,.]+$/)) { // Negative number = debit
          const amtRaw = amount1Field.replace(/[,-]/g, '').replace('-', '');
          const parsedAmount = Number(amtRaw);
          if (!Number.isNaN(parsedAmount) && parsedAmount > 0) {
            debitAmount = parsedAmount;
            isExpenseDebited = true;
            console.log('[MAJOR_EXPENSE] Found debited expense:', account, '₹', debitAmount);
          }
        }
      }
    }
    
    // Only include expenses that were actually debited (money spent)
    if (account && debitAmount > 0 && isExpenseDebited) {
      results.push({
        date: currentDate,
        account: account,
        amount: debitAmount,
        type: 'debit',
        description: line.trim()
      });
    }
  }
  
  console.log('[MAJOR_EXPENSE] Found', results.length, 'debited major expense entries');
  return results;
}

// Extract Custom Duty expenses (moved from existing logic)
function extractCustomDutyFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  
  console.log('[CUSTOM_DUTY] Processing', lines.length, 'lines for Custom Duty detection');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Check if line contains Custom Duty keywords
    const hasCustomDutyKeyword = CUSTOM_DUTY_KEYWORDS.some(keyword => 
      line.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (!hasCustomDutyKeyword) continue;
    
    const dateMatch = dateRegex.exec(line);
    if (!dateMatch) continue;
    
    const currentDate = dateMatch[0];
    const monthAbbr = dateMatch[2].toLowerCase();
    const year = dateMatch[3];
    
    if (wantedMonthsSet.size > 0 && !wantedMonthsSet.has(monthAbbr)) continue;
    if (wantedYearsSet.size > 0 && !wantedYearsSet.has(year)) continue;
    
    const fields = line.split(',');
    let account = '';
    let amount = 0;
    
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i].replace(/^"|"$/g, '');
      if (CUSTOM_DUTY_KEYWORDS.some(keyword => field.toLowerCase().includes(keyword.toLowerCase()))) {
        account = field;
        for (let j = i + 1; j < fields.length; j++) {
          const amtField = fields[j].replace(/^"|"$/g, '');
          if (amtField && amtField.match(/^-?[0-9,.]+$/)) {
            const amtRaw = amtField.replace(/[,-]/g, '');
            const parsedAmount = Math.abs(Number(amtRaw));
            if (!Number.isNaN(parsedAmount) && parsedAmount > 0) {
              amount = parsedAmount;
              break;
            }
          }
        }
        break;
      }
    }
    
    if (account && amount > 0) {
      results.push({
        date: currentDate,
        account: account,
        amount: amount,
        description: line.trim()
      });
    }
  }
  
  console.log('[CUSTOM_DUTY] Found', results.length, 'Custom Duty entries');
  return results;
}

// Specialized P&L Query Handler - Simple approach for P&L data
async function handlePLQuery(req, res, plFiles, question, chatHistory) {
  try {
    console.log('[PL_CHAT] Handling P&L query with', plFiles.length, 'P&L files');
    
    // Get all chunks from P&L files (should be 3-4 max)
    const allPLChunks = [];
    const fileNames = [];
    
    for (const plFile of plFiles) {
      fileNames.push(plFile.originalFileName);
      allPLChunks.push({
        content: plFile.content,
        companyName: plFile.companyName,
        fileName: plFile.originalFileName,
        periodFrom: plFile.periodFrom,
        periodTo: plFile.periodTo,
        plType: plFile.plType,
        category: plFile.category
      });
    }
    
    console.log('[PL_CHAT] Total P&L chunks:', allPLChunks.length);
    console.log('[PL_CHAT] Files:', fileNames.join(', '));
    
    // Combine all P&L content
    const combinedPLContent = allPLChunks.map((chunk, index) => 
      `[P&L CHUNK ${index + 1} - ${chunk.fileName}]\n${chunk.content}\n`
    ).join('\n');
    
    // Create P&L-specific system prompt
    const plSystemPrompt = {
      role: 'system',
      content: `1. Core Persona & Context
You are an expert Financial Analyst specializing in interpreting financial statements from Indian accounting software, particularly Tally. You are precise, data-driven, and your primary goal is to translate raw P&L data into clear, accurate business intelligence for users in India.

2. CRITICAL RULES & CONSTRAINTS (MUST FOLLOW)
P&L is NOT a Cash Flow Statement: This is the most important rule. A Profit & Loss statement is based on accrual accounting (revenue when earned, expenses when incurred), not cash movement.

Action: If a user asks for "cash flow," "inflows vs. outflows," or a similar cash-based analysis, you MUST begin your response by clarifying that the P&L statement cannot provide this. Explain the difference clearly and concisely.

DO NOT attempt to create a cash flow summary by relabeling income as "inflows" and expenses as "outflows." This is incorrect.

Recognize Hierarchical Data (No Double-Counting): Tally P&L exports have a specific structure where some accounts are totals/subtotals. CRITICAL RULES:

- If you see "Sales Accounts-Import" with a value, and then "Marble Sales Account" and "Sales Pista" below it, the individual items are COMPONENTS of the total, not additions to it
- The P&L shows final totals at the bottom (like ₹1,39,35,78,551.83) - this is the ACTUAL total revenue
- NEVER add parent totals to child accounts - this creates massive double-counting errors
- When analyzing revenue, identify the main revenue streams but recognize the final total is already calculated
- Look for the period covered (e.g., "1-Apr-22 to 31-May-25") and clearly state this timeframe

Currency and Formatting: The financial data is in Indian Rupees (INR).

Action: All monetary values in your response MUST be prefixed with the Rupee symbol (₹). Use the Indian numbering system for commas (lakhs and crores), for example: ₹1,75,67,16,68.35.

Identify Non-Cash Expenses: You must correctly identify non-cash items like "Depreciation" and "Provision for Expense."

Action: These items are key examples to use when explaining why a P&L statement is not a cash flow statement. They reduce profit but do not represent an actual cash outflow in the period.

3. Key Analytical Capabilities
Revenue Analysis: Identify and quantify major sales and income streams.

Expense Breakdown: Categorize and analyze direct vs. indirect expenses. Identify the largest cost drivers.

Profitability Metrics: Calculate and explain Gross Profit, Net Profit, and key profit margins.

Cost Structure Analysis: Interpret the company's spending patterns.

Financial Ratios: Calculate relevant ratios possible from the P&L (e.g., Gross Profit Margin, Net Profit Margin).

4. Response Protocol
State Limitations First: If a question cannot be answered accurately with the given P&L data (like a cash flow query), begin your response by stating this limitation clearly.

Structure and Clarity: Organize responses with clear headings and bullet points.

Reference the Data: Back up every insight by referencing the specific line item and its value (e.g., "The Net Profit was ₹1,46,85,539.41, as shown...").

Provide Insights, Not Just Data: Explain what the numbers mean for the business's performance.

5. Correct Response Examples

Example 1 - Revenue Question:
User Query: "What is the total revenue for FY 2023-24?"

Your CORRECT Response:
"Based on the P&L statement provided, I need to clarify the reporting period first. The data covers 1-Apr-22 to 31-May-25 (over 3 years), not just FY 2023-24.

**Total Revenue for Entire Period (Apr 2022 to May 2025):** ₹1,39,35,78,551.83

**Major Revenue Components:**
- Sales Accounts-Import: ₹1,37,65,14,093.63 (primary revenue stream)
- Direct Incomes-Import: ₹1,02,78,503.08
- Sales Accounts-Export: ₹16,43,749.21
- Other income streams: ₹1,51,42,205.91

**Important Note:** This P&L covers 37 months, not a single fiscal year. To get FY 2023-24 specific figures, you would need a P&L statement covering only April 2023 to March 2024."

Example 2 - Cash Flow Question:
User Query: "Summarize cashflow (inflows vs. outflows)"

Your CORRECT Response:
"A Profit & Loss statement cannot provide cash flow analysis. P&L shows profitability based on accrual accounting (revenue when earned, expenses when incurred), not actual cash movement. It includes non-cash items like Depreciation (₹16,88,840 in this case).

**Profitability Summary for Period (1-Apr-22 to 31-May-25):**
- **Total Revenue:** ₹1,39,35,78,551.83
- **Total Expenses:** ₹1,77,59,39,59.84  
- **Net Profit:** ₹1,46,85,539.41

For actual cash flow analysis, you need a Cash Flow Statement that tracks real cash inflows and outflows."`};
    
    // Prepare chat history
    const historyMessages = Array.isArray(chatHistory)
      ? chatHistory.slice(-6).map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        }))
      : [];
    
    // Create user prompt with P&L data and question
    const userPrompt = `**P&L DATA ANALYSIS REQUEST**

**Company:** ${allPLChunks[0]?.companyName || 'Unknown'}
**Period:** ${allPLChunks[0]?.periodFrom ? new Date(allPLChunks[0].periodFrom).toDateString() : 'Unknown'} to ${allPLChunks[0]?.periodTo ? new Date(allPLChunks[0].periodTo).toDateString() : 'Unknown'}
**Files:** ${fileNames.join(', ')}

**P&L STATEMENT DATA:**
${combinedPLContent}

**USER QUESTION:** ${question}

Please analyze the above P&L data and provide a comprehensive response to the user's question.`;
    
    const messages = [
      plSystemPrompt,
      ...historyMessages,
      { role: 'user', content: userPrompt }
    ];
    
    console.log('[PL_CHAT] Calling OpenAI with P&L-specific prompt');
    
    // Call OpenAI API
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        messages,
        max_tokens: 2000,
        temperature: 0.2 // Lower temperature for more precise financial analysis
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const answer = openaiRes.data.choices[0].message.content;
    console.log('[PL_CHAT] P&L analysis completed, response length:', answer.length);
    
    return res.json({ answer });
    
  } catch (error) {
    console.error('[PL_CHAT] Error:', error);
    return res.status(500).json({ error: 'P&L analysis failed' });
  }
}

// Helper: extract purchase entries from CSV-like content for a specific month/year
function extractPurchasesFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  // Pattern example: 30-Oct-23,"Shreenath Shipping Agency","","Purc",,-2,64,678.00,
  const lineRegex = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","Purc",,(-?[0-9,.-]+)\b.*$/m;
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('"Purc"')) continue;
    const dm = dateRegex.exec(line);
    if (!dm) continue;
    const day = dm[1];
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    const m = lineRegex.exec(line);
    if (m) {
      const date = m[1];
      const account = m[2] || '';
      let amtRaw = m[3];
      
      // Handle Indian number formatting: remove commas and dashes used as separators
      amtRaw = amtRaw.replace(/[,-]/g, '');
      
      const amount = Number(amtRaw);
      if (!Number.isNaN(amount)) {
        results.push({ date, account, amount });
      }
    }
  }
  return results;
}

// Helper: extract payment entries (Type: Pymt) handling multiple amount column variants
function extractPaymentsFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  
  for (const line of lines) {
    if (!line.includes('"Pymt"')) continue;
    
    const dm = dateRegex.exec(line);
    if (!dm) continue;
    
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    
    // Split by comma and handle quoted fields properly
    const fields = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current) fields.push(current);
    
    // Find date, account, and amount from parsed fields
    const date = dm[0]; // Use matched date
    let account = '';
    let amount = 0;
    
    // Look for account name (usually in quotes after date)
    for (let i = 1; i < fields.length; i++) {
      const field = fields[i].replace(/^"|"$/g, ''); // Remove quotes
      if (field && field !== 'Pymt' && field !== '' && !field.match(/^-?[0-9,.]+$/)) {
        account = field;
        break;
      }
    }
    
    // Look for amount (first non-empty numeric field after Pymt)
    let foundPymt = false;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i].replace(/^"|"$/g, '');
      if (field === 'Pymt') {
        foundPymt = true;
        continue;
      }
      if (foundPymt && field && field.match(/^-?[0-9,.]+$/)) {
        const amtRaw = field.replace(/,/g, '');
        const parsedAmount = Number(amtRaw);
        if (!Number.isNaN(parsedAmount) && parsedAmount !== 0) {
          amount = parsedAmount;
          break;
        }
      }
    }
    
    if (account && amount !== 0) {
      results.push({ date, account, amount });
    }
  }
  return results;
}

// Helper: extract Custom Duty expenses by exact description match
function extractCustomDutyFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  
  console.log('[CUSTOM_DUTY] Processing', lines.length, 'lines for Custom Duty extraction');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Look for Custom Duty in the account/description field (including variations)
    if (line.includes('Custom Duty') || line.includes('Indian Customs') || line.includes('Customs')) {
      console.log('[CUSTOM_DUTY] Found Custom Duty line:', line.substring(0, 100));
      
      // Check if this line has a date (same line)
      const dateMatch = dateRegex.exec(line);
      if (!dateMatch) {
        console.log('[CUSTOM_DUTY] No date found on Custom Duty line, skipping');
        continue;
      }
      
      const currentDate = dateMatch[0];
      const mon = dateMatch[2].toLowerCase();
      const yy = dateMatch[3];
      
      console.log('[CUSTOM_DUTY] Date found:', currentDate, 'Month:', mon, 'Year:', yy);
      console.log('[CUSTOM_DUTY] Wanted months:', Array.from(wantedMonthsSet), 'Wanted years:', Array.from(wantedYearsSet));
      
      const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
      const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
      
      console.log('[CUSTOM_DUTY] Month OK:', monthOk, 'Year OK:', yearOk);
      
      if (!monthOk || !yearOk) {
        console.log('[CUSTOM_DUTY] Date filtering failed, skipping entry');
        continue;
      }
      
      // Parse the line to extract amount
      const fields = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
          current += char;
        } else if (char === ',' && !inQuotes) {
          fields.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      if (current) fields.push(current);
      
      // Find the Custom Duty account and corresponding amount
      let account = '';
      let amount = 0;
      
      console.log('[CUSTOM_DUTY] Parsing fields:', fields);
      
      // Look for account field containing Custom Duty variations
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i].replace(/^"|"$/g, '');
        if (field.includes('Custom Duty') || field.includes('Indian Customs') || field.includes('Customs')) {
          account = field;
          console.log('[CUSTOM_DUTY] Found account field:', account);
          
          // Look for amount in subsequent fields (typically field 4 or 5 in CSV)
          for (let j = i + 1; j < fields.length; j++) {
            const amtField = fields[j].replace(/^"|"$/g, '');
            console.log('[CUSTOM_DUTY] Checking amount field', j, ':', amtField);
            
            if (amtField && amtField.match(/^-?[0-9,.]+$/)) {
              const amtRaw = amtField.replace(/[,-]/g, '');
              const parsedAmount = Math.abs(Number(amtRaw)); // Take absolute value for expenses
              console.log('[CUSTOM_DUTY] Parsed amount:', parsedAmount);
              
              if (!Number.isNaN(parsedAmount) && parsedAmount > 0) {
                amount = parsedAmount;
                console.log('[CUSTOM_DUTY] Valid amount found:', amount);
                break;
              }
            }
          }
          break;
        }
      }
      
      if (account && amount > 0) {
        results.push({ 
          date: currentDate, 
          account, 
          amount,
          description: 'Custom Duty'
        });
      }
    }
  }
  
  return results;
}

// Helper: extract sales entries (Type: Sale) from CSV-like content for a specific month/year
function extractSalesFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  // Handle both common layouts after Type field:
  // A) 18-Oct-24,"Account","","Sale",-47,39,65,,  (Indian format with dashes)
  // B) 18-Oct-24,"Account","","Sale",,-47,39,65,  (Indian format with dashes)
  const lineRegexA = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","Sale",(-?[0-9,.-]+)\b.*$/m;
  const lineRegexB = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","Sale",,(-?[0-9,.-]+)\b.*$/m;
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('"Sale"')) continue;
    const dm = dateRegex.exec(line);
    if (!dm) continue;
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    let m = lineRegexA.exec(line);
    if (!m) m = lineRegexB.exec(line);
    if (m) {
      const date = m[1];
      const account = m[2] || '';
      let amtRaw = m[3];
      
      // Handle Indian number formatting: -47,39,65 should become 473965
      // Remove all commas and dashes (formatting characters)
      amtRaw = amtRaw.replace(/[,-]/g, '');
      
      const amount = Number(amtRaw);
      if (!Number.isNaN(amount) && amount > 0) { // Only positive amounts for sales
        results.push({ date, account, amount });
      }
    }
  }
  return results;
}

// Helper: extract credit note entries (Type: C/Note) from CSV-like content for a specific month/year
function extractCreditNotesFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  // Pattern example: 1-May-22,"ACE Travels India","","C/Note",,19660.00,
  const lineRegexA = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","C\/Note",(-?[0-9,.-]+)\b.*$/m;
  const lineRegexB = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","C\/Note",,(-?[0-9,.-]+)\b.*$/m;
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('"C/Note"')) continue;
    const dm = dateRegex.exec(line);
    if (!dm) continue;
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    let m = lineRegexA.exec(line);
    if (!m) m = lineRegexB.exec(line);
    if (m) {
      const date = m[1];
      const account = m[2] || '';
      let amtRaw = m[3];
      
      // Handle Indian number formatting: remove commas and dashes used as separators
      amtRaw = amtRaw.replace(/[,-]/g, '');
      
      const amount = Number(amtRaw);
      if (!Number.isNaN(amount) && amount > 0) { // Only positive amounts for credit notes
        results.push({ date, account, amount });
      }
    }
  }
  return results;
}

// Helper: extract cash/bank transactions from CSV-like content for cash balance calculation
function extractCashTransactionsFromText(content, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  
  // Cash/Bank account patterns
  const cashPatterns = [
    /kotak mahindra bank/i,
    /hdfc bank/i,
    /icici bank/i,
    /sbi bank/i,
    /axis bank/i,
    /canara bank/i,
    /pnb bank/i,
    /union bank/i,
    /indusind bank/i,
    /dcb niyo/i,
    /cash/i,
    /bank/i
  ];
  
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  
  let currentDate = '';
  let currentVoucherType = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const parts = line.split(',');
    if (parts.length < 5) continue;
    
    const dateStr = parts[0]?.trim().replace(/"/g, '');
    const account = parts[1]?.trim().replace(/"/g, '');
    const voucherType = parts[3]?.trim().replace(/"/g, '');
    const amtStr4 = parts[4]?.trim().replace(/"/g, '');
    const amtStr5 = parts[5]?.trim().replace(/"/g, '');
    
    // Update current date and voucher type if this is a primary entry
    if (dateStr && dateRegex.test(dateStr)) {
      currentDate = dateStr;
      if (voucherType) currentVoucherType = voucherType;
    }
    
    // Check date filtering
    if (!currentDate) continue;
    const dm = dateRegex.exec(currentDate);
    if (!dm) continue;
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    
    // Check if this line contains a cash/bank account
    const isCashAccount = cashPatterns.some(pattern => pattern.test(account));
    if (!isCashAccount) continue;
    
    // Parse amount from either column 4 or 5
    let amount = 0;
    let isCredit = false;
    
    if (amtStr4 && amtStr4 !== '' && !isNaN(Number(amtStr4.replace(/[,-]/g, '')))) {
      let amtRaw = amtStr4;
      let isNegative = amtRaw.startsWith('-');
      if (isNegative) amtRaw = amtRaw.substring(1);
      amtRaw = amtRaw.replace(/[,-]/g, '');
      amount = Number(amtRaw);
      if (isNegative) amount = -amount;
      isCredit = false; // Debit to bank (outflow)
    } else if (amtStr5 && amtStr5 !== '' && !isNaN(Number(amtStr5.replace(/[,-]/g, '')))) {
      let amtRaw = amtStr5;
      let isNegative = amtRaw.startsWith('-');
      if (isNegative) amtRaw = amtRaw.substring(1);
      amtRaw = amtRaw.replace(/[,-]/g, '');
      amount = Number(amtRaw);
      if (isNegative) amount = -amount;
      isCredit = true; // Credit to bank (inflow)
    }
    
    if (amount !== 0) {
      // For cash balance calculation, we need to consider the voucher type:
      // - For Receipts (Rcpt): Credit to bank = money coming IN (positive)
      // - For Payments (Pymt): Credit to bank = money going OUT (negative)
      // - For Journals (Jrnl): Follow the natural debit/credit logic
      
      let cashFlowAmount;
      if (currentVoucherType && currentVoucherType.toLowerCase().includes('pymt')) {
        // For payments: Credit to bank means money going out (negative)
        cashFlowAmount = isCredit ? -amount : amount;
      } else if (currentVoucherType && currentVoucherType.toLowerCase().includes('rcpt')) {
        // For receipts: Credit to bank means money coming in (positive)
        cashFlowAmount = isCredit ? amount : -amount;
      } else {
        // For journals and others: Credit = positive, Debit = negative
        cashFlowAmount = isCredit ? amount : -amount;
      }
      
      // Determine transaction type
      let transactionType = 'unknown';
      if (currentVoucherType) {
        const vType = currentVoucherType.toLowerCase();
        if (vType.includes('rcpt') || vType.includes('receipt')) {
          transactionType = 'receipt';
        } else if (vType.includes('pymt') || vType.includes('payment')) {
          transactionType = 'payment';
        } else if (vType.includes('jrnl') || vType.includes('journal')) {
          transactionType = 'journal';
        } else if (vType.includes('sale')) {
          transactionType = 'sale';
        }
      }
      
      results.push({ 
        date: currentDate, 
        account, 
        amount: cashFlowAmount, 
        voucherType: currentVoucherType,
        transactionType
      });
    }
  }
  
  return results;
}

// Helper: extract entries for a given voucher type token (e.g., 'Jrnl') with date filters
function extractEntriesOfTypeFromText(content, typeToken, wantedMonthsSet, wantedYearsSet) {
  const results = [];
  if (!content || typeof content !== 'string') return results;
  // Example: 1-May-24,"Rent- Kanakia Office","","Jrnl",-1,32,300.00,, ...
  const typeQuoted = typeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(
    `^(\\d{1,2}-[A-Za-z]{3}-\\d{2}),"([^"]*)","","${typeQuoted}",(-?[0-9,.-]+)\\b.*$`,
    'm'
  );
  const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(`"${typeToken}"`)) continue;
    const dm = dateRegex.exec(line);
    if (!dm) continue;
    const day = dm[1];
    const mon = dm[2].toLowerCase();
    const yy = dm[3];
    const monthOk = wantedMonthsSet.size === 0 || wantedMonthsSet.has(mon);
    const yearOk = wantedYearsSet.size === 0 || wantedYearsSet.has(yy);
    if (!monthOk || !yearOk) continue;
    const m = lineRegex.exec(line);
    if (m) {
      const date = m[1];
      const account = m[2] || '';
      let amtRaw = m[3];
      
      // Handle Indian number formatting: remove commas and dashes used as separators
      amtRaw = amtRaw.replace(/[,-]/g, '');
      
      const amount = Number(amtRaw);
      if (!Number.isNaN(amount)) {
        results.push({ date, account, amount });
      }
    }
  }
  return results;
}

const QUERY_TYPE_KEYWORDS = {
  sales: ['sale', 'sales', 'revenue', 'income', 'sold'],
  purchase: ['purchase', 'purchases', 'purc', 'buy', 'bought', 'supplier', 'vendor', 'material', 'inventory', 'stock', 'goods received', 'grn'],
  journal: ['journal', 'jrnl', 'adjustment', 'transfer'],
  expense: ['expense', 'expenses', 'cost', 'expenditure', 'pymt', 'payment', 'payments', 'outflow', 'outgoing', 'paid', 'supplier', 'vendor', 'loan', 'tds', 'tax', 'salary', 'rent', 'insurance', 'travel', 'freight', 'shipping', 'custom', 'duty'],
  receipt: ['receipt', 'rcpt', 'received', 'collection'],
  payment: ['payment', 'payments', 'pymt', 'paid', 'pay'],
  credit_note: ['credit note', 'credit notes', 'c/note', 'cnote', 'sales return', 'return'],
  cash_balance: ['cash', 'bank', 'icici', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'canara', 'pnb', 'union bank', 'current account', 'savings account', 'ca', 'sb', 'receipt', 'rcpt', 'payment', 'pymt', 'journal', 'jrnl'],
  fy_profit: ['profit in fy', 'fy profit', 'financial year profit', 'profit for fy', 'profit from', 'annual profit', 'yearly profit'],
  fy_sales: ['sales in fy', 'fy sales', 'financial year sales', 'sales for fy', 'total sales in fy', 'annual sales', 'yearly sales'],
  profit: ['profit', 'loss', 'net income', 'earnings', 'pnl', 'p&l', 'profitability', 'accounting profit', 'net profit', 'gross profit'],
  ledger: [] // Ledger queries are detected by ledger context, not keywords
};

// Enhanced bank detection patterns
const BANK_PATTERNS = {
  'icici': ['icici', 'icici bank', 'icici ltd', 'icici limited'],
  'hdfc': ['hdfc', 'hdfc bank', 'hdfc ltd', 'hdfc limited'],
  'sbi': ['sbi', 'state bank', 'state bank of india'],
  'kotak': ['kotak', 'kotak bank', 'kotak mahindra'],
  'indusind': ['indusind', 'indusind bank'],
  'axis': ['axis', 'axis bank'],
  'yes': ['yes', 'yes bank'],
  'bajaj': ['bajaj', 'bajaj finance', 'bajaj finserv'],
  'pnb': ['pnb', 'punjab national bank'],
  'canara': ['canara', 'canara bank'],
  'union': ['union', 'union bank'],
  'bank of baroda': ['bob', 'bank of baroda', 'baroda bank']
};

function detectQueryType(query) {
  const lower = query.toLowerCase();
  
  // Check specific FY query types first (higher priority)
  const priorityTypes = ['fy_profit', 'fy_sales'];
  for (const type of priorityTypes) {
    const keywords = QUERY_TYPE_KEYWORDS[type];
    if (keywords && keywords.some(k => lower.includes(k))) {
      return type;
    }
  }
  
  // Check payment queries before expense (to avoid overlap)
  if (/\b(total\s+payments?|payments?\s+made|payments?\s+in|payments?\s+for)\b/i.test(lower)) {
    return 'payment';
  }
  
  // Then check general query types
  for (const [type, keywords] of Object.entries(QUERY_TYPE_KEYWORDS)) {
    if (!priorityTypes.includes(type) && keywords.some(k => lower.includes(k))) {
      return type;
    }
  }
  return null;
}

function detectBankQuery(query) {
  const lower = query.toLowerCase();
  for (const [bank, patterns] of Object.entries(BANK_PATTERNS)) {
    if (patterns.some(pattern => lower.includes(pattern))) {
      return bank;
    }
  }
  return null;
}

function filterChunksByType(chunks, type) {
  if (!type) return chunks;
  
  // For expense queries, skip keyword filtering and return all chunks
  // Let the AI analyze all data and identify major expenses directly
  if (type === 'expense') {
    console.log('[CHAT] Expense query detected - returning all chunks for AI analysis');
    return chunks;
  }
  
  // For payment queries, skip keyword filtering and return all chunks
  // Let the AI analyze all data and identify major payments directly
  if (type === 'payment') {
    console.log('[CHAT] Payment query detected - returning all chunks for AI analysis');
    return chunks;
  }
  
  // For FY profit queries, return all chunks for March P&L search
  if (type === 'fy_profit') {
    console.log('[CHAT] FY Profit query detected - returning all chunks for March P&L search');
    return chunks;
  }
  
  // For FY sales queries, return all chunks for FY date filtering
  if (type === 'fy_sales') {
    console.log('[CHAT] FY Sales query detected - returning all chunks for FY date filtering');
    return chunks;
  }
  
  // For ledger queries, return all chunks for ledger-specific filtering
  if (type === 'ledger') {
    console.log('[CHAT] Ledger query detected - returning all chunks for ledger-specific filtering');
    return chunks;
  }
  
  const keywords = QUERY_TYPE_KEYWORDS[type];
  
  if (!keywords) {
    console.log('[CHAT] No keywords found for query type:', type);
    return chunks; // Return all chunks if no keywords defined
  }
  
  console.log('[CHAT] Filtering chunks by type:', type, 'using keywords:', keywords);
  
  const filtered = chunks.filter(chunk => {
    const content = (chunk.content || '').toLowerCase();
    const matches = keywords.some(k => content.includes(k.toLowerCase()));
    
    if (type === 'cash_balance' && matches) {
      console.log('[CHAT] Found cash_balance match in chunk with keywords:', keywords.filter(k => content.includes(k.toLowerCase())));
    }
    
    return matches;
  });
  
  console.log('[CHAT] Filtered chunks:', filtered.length, 'out of', chunks.length, 'for type:', type);
  return filtered;
}

// Build a focused keyword list based on the query and detected type
function buildQueryKeywords(userQuestion, queryType, bankName = null) {
  const base = [
    // Common financial terms
    'voucher', 'narration', 'account', 'ledger', 'bank', 'ltd', 'limited'
  ];

  if (queryType === 'loan') {
    base.push(
      'loan', 'loans', 'secured loan', 'unsecured loan', 'od', 'overdraft',
      'bank loan', 'interest on loan', 'cc account', 'borrowing', 'finance'
    );
    
    // Add bank-specific keywords if bank is mentioned
    if (bankName) {
      const bankPatterns = BANK_PATTERNS[bankName] || [bankName];
      base.push(...bankPatterns);
    }
  } else if (queryType === 'sales') {
    base.push('sale', 'sales', 'igst', 'cgst', 'sgst', 'invoice');
  } else if (queryType === 'purchase') {
    base.push('purchase', 'purc', 'supplier', 'grn', 'igst', 'cgst', 'sgst', 'material', 'inventory', 'stock', 'goods received');
  } else if (queryType === 'payment') {
    base.push('payment', 'pymt', 'pymts', 'debit', 'credit', 'voucher');
  } else if (queryType === 'journal') {
    base.push('journal', 'jrnl', 'tds', 'rent');
  } else if (queryType === 'expense') {
    base.push('expense', 'expenses', 'rent', 'salary', 'bank charges', 'fees');
  } else if (queryType === 'receipt') {
    base.push('receipt', 'rcpt', 'income');
  } else if (queryType === 'cash_balance') {
    base.push(
      'cash', 'bank', 'icici', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 
      'canara', 'pnb', 'union bank', 'current account', 'savings account',
      'ca', 'sb', 'receipt', 'rcpt', 'payment', 'pymt', 'journal', 'jrnl'
    );
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
    const { question, selectedFiles, chatHistory } = req.body;
    const userId = req.user.userId;
    
    console.log('[CHAT] Authenticated user:', req.user.email, 'asking:', question);
    console.log('[CHAT] Received question:', question, 'for user:', userId);
    console.log('[CHAT] Selected files:', selectedFiles);
    console.log('[CHAT] Chat history length:', chatHistory ? chatHistory.length : 0);

    // Check if P&L files are selected - use simplified P&L handler
    if (selectedFiles && selectedFiles.length > 0) {
      const plFiles = await PLData.find({ 
        userId, 
        originalFileName: { $in: selectedFiles }
      });
      
      if (plFiles.length > 0) {
        console.log('[CHAT] P&L files detected, using specialized P&L handler');
        return await handlePLQuery(req, res, plFiles, question, chatHistory);
      }
    }
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
    
    // Check for individual ledger queries
    const { extractLedgerContext } = require('../utils/queryPreprocessor');
    const ledgerContext = await extractLedgerContext(question, userId);
    console.log('[CHAT] Ledger context detected:', ledgerContext);
    
    // Detect query type and bank name
    // Ledger queries are ONLY enabled when user explicitly checks the checkbox
    const userWantsLedgerQuery = req.body.isLedgerQuery === true;
    let queryType;
    
    if (userWantsLedgerQuery) {
      console.log('[CHAT] User explicitly selected ledger query - forcing ledger type');
      queryType = 'ledger';
    } else {
      // Standard auto-detection - no ledger processing unless checkbox is checked
      queryType = detectQueryType(question);
      console.log('[CHAT] Auto-detect mode - ledger processing disabled (checkbox unchecked)');
    }
    
    const bankName = detectBankQuery(question);
    console.log('[CHAT] Query type detected:', queryType, 'Bank detected:', bankName);
    
    // Enhanced purchase entry detection
    if (queryType === 'purchase') {
      const purchaseEntries = extractPurchaseEntries(allDataChunks);
      const purchaseValidation = validatePurchaseEntries(purchaseEntries);
      console.log('[CHAT] Found', purchaseEntries.length, 'purchase-related entries');
      console.log('[CHAT] Purchase validation:', purchaseValidation);
      
      // If user specifically asks for purchase entries, prioritize them
      if (question.toLowerCase().includes('purchase') || question.toLowerCase().includes('purchases')) {
        console.log('[CHAT] Purchase-specific query detected, prioritizing purchase entries');
      }
    }
    
    // Enhanced bank-specific query handling
    if (bankName) {
      const bankEntries = extractBankSpecificEntries(allDataChunks, bankName);
      const bankValidation = validateBankEntries(bankEntries, bankName);
      console.log('[CHAT] Found', bankEntries.length, 'entries for bank:', bankName);
      console.log('[CHAT] Bank validation:', bankValidation);
      
      // Prioritize bank-specific entries for bank queries
      if (bankEntries.length > 0) {
        console.log('[CHAT] Bank-specific entries found, will prioritize in response');
      }
    }
    
    // If a specific month and year are requested, prefilter by monthKey to ensure full coverage
    let prefilteredChunks = allDataChunks;
    if (dateContext && dateContext.isDateSpecific && (dateContext.months || []).length === 1 && (dateContext.years || []).length === 1) {
      const monthAbbrevs = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const mKey = String(dateContext.months[0]).toLowerCase().slice(0,3);
      const yRaw = String(dateContext.years[0]);
      const yyyy = yRaw.length === 2 ? (parseInt(yRaw, 10) < 70 ? 2000 + parseInt(yRaw, 10) : 1900 + parseInt(yRaw, 10)) : parseInt(yRaw, 10);
      const yyyyStr = String(yyyy).padStart(4, '0');
      const mm = monthAbbrevs[mKey];
      if (mm) {
        const monthKey = `${yyyyStr}-${mm}`;
        prefilteredChunks = allDataChunks.filter(ch => (ch.monthKey || '') === monthKey);
        console.log('[CHAT] monthKey prefilter applied:', monthKey, 'chunks:', prefilteredChunks.length);
      }
    }

    const filteredChunks = filterChunksByType(prefilteredChunks, queryType);
    if (filteredChunks.length === 0) {
      console.log('[CHAT] No relevant data found for query type:', queryType);
      return res.status(404).json({ error: 'No relevant data found for your query type.' });
    }

    // Apply date filtering if date context is detected (skip for fy_profit queries)
    let dateFilteredChunks = filteredChunks;
    if (dateContext.isDateSpecific && queryType !== 'fy_profit') {
      console.log('[CHAT] Applying date filtering with context:', dateContext);
      dateFilteredChunks = filterChunksByDate(filteredChunks, dateContext);
      console.log('[CHAT] Date filtering applied. Chunks before:', filteredChunks.length, 'after:', dateFilteredChunks.length);
    } else if (queryType === 'fy_profit') {
      console.log('[CHAT] Skipping date filtering for fy_profit query - will do targeted March search instead');
      dateFilteredChunks = filteredChunks;
      
      // Debug: Check if any chunks contain May 14 data
      const chunksWithMay14 = dateFilteredChunks.filter(ch => {
        const content = ch.content || (ch._doc && ch._doc.content) || '';
        return content.includes('14-May-25');
      });
      console.log('[CHAT] Chunks containing 14-May-25 after date filtering:', chunksWithMay14.length);
    } else if (queryType === 'fy_sales') {
      console.log('[CHAT] FY Sales query detected - will do custom FY date filtering');
      dateFilteredChunks = filteredChunks; // Keep all chunks for custom FY filtering
    }
    
    // Placeholder for deterministic summaries
    let paymentSummary = '';
    let profitSummary = '';

    // Deterministic precomputation: payments (Pymt) for date-specific queries
    if (queryType === 'payment' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      console.log('[CHAT] Payment extraction - wanted months:', Array.from(wantedMonths), 'years:', Array.from(wantedYears));
      console.log('[CHAT] Payment extraction - scanning', dateFilteredChunks.length, 'date-filtered chunks');
      
      const entries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        
        // Debug: Check if this chunk contains May 14 data
        if (text.includes('14-May-25')) {
          console.log('[CHAT] Found chunk with 14-May-25 data, length:', text.length);
          console.log('[CHAT] Sample of chunk:', text.substring(0, 500));
        }
        
        const found = extractPaymentsFromText(text, wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) {
          console.log('[CHAT] Extracted', found.length, 'payments from chunk, sample:', found.slice(0, 3));
          entries.push(...found);
        }
      }
      
      // Compute totals and create comprehensive summary with ALL entries
      const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
      
      // Group entries by date for complete listing
      const entriesByDate = {};
      entries.forEach(e => {
        if (!entriesByDate[e.date]) entriesByDate[e.date] = [];
        entriesByDate[e.date].push(e);
      });
      
      // Create complete listing of ALL entries organized by date
      const allEntriesText = Object.keys(entriesByDate)
        .sort((a, b) => {
          // Sort dates chronologically
          const parseDate = (dateStr) => {
            const [day, month, year] = dateStr.split('-');
            return new Date(`20${year}`, ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(month), parseInt(day));
          };
          return parseDate(a) - parseDate(b);
        })
        .map(date => {
          const dayEntries = entriesByDate[date];
          const entryList = dayEntries.map(e => `  • ${e.account}: ${e.amount.toLocaleString()}`).join('\n');
          return `${date}:\n${entryList}`;
        })
        .join('\n\n');
      
      paymentSummary = `\n\n=== COMPLETE PAYMENT ENTRIES LIST ===\n` +
        `TOTAL: ${entries.length} entries, Amount: ${total.toLocaleString()}\n\n` +
        `${allEntriesText}\n\n` +
        `=== END COMPLETE LIST ===\n`;
      console.log('[CHAT] Precomputed payments (date-filtered scan):', { count: entries.length, total });
      
      // Debug: Check if May 14 entries are in the results
      const may14Entries = entries.filter(e => e.date.includes('14-May-25'));
      console.log('[CHAT] May 14 entries found:', may14Entries.length, may14Entries.slice(0, 3));
    }
    
    // Deterministic precomputation: FY profit calculation (optimized)
    if (queryType === 'fy_profit' && dateContext && dateContext.isDateSpecific) {
      console.log('[CHAT] FY Profit query detected - using optimized March 31st P&L search');
      
      const profitEntries = [];
      
      // Extract FY years from query to determine target March year
      // FY 2022-23 → look for 31-Mar-23, FY 2023-24 → look for 31-Mar-24
      let targetMarchYear = null;
      const fyMatch = question.match(/(?:fy|financial\s*year)?\s*(\d{4})[-\/\s]?(\d{2,4})/i);
      if (fyMatch) {
        const endYear = fyMatch[2];
        targetMarchYear = endYear.length === 2 ? endYear : endYear.slice(-2);
        console.log('[CHAT] FY detected:', fyMatch[1] + '-' + fyMatch[2], '→ Target March year:', targetMarchYear);
      }
      
      // Search for specific March year P&L entries
      const marchPattern = targetMarchYear ? `31-Mar-${targetMarchYear}` : '31-Mar-';
      const marchChunks = dateFilteredChunks.filter(chunk => {
        const content = chunk.content || '';
        return content.includes(marchPattern) && content.includes('Profit & Loss A/c');
      });
      
      console.log('[CHAT] Searching for pattern:', marchPattern, '- Found', marchChunks.length, 'chunks containing March P&L entries');
      
      for (const chunk of marchChunks) {
        const lines = chunk.content.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line1 = lines[i];
          const line2 = lines[i + 1];
          
          // Pattern for FY profit entries using exact format: 31-Mar-23,"Profit & Loss A/c","","Jrnl",-3007477.83,,
          if (line1.includes(marchPattern) && line1.includes('"Profit & Loss A/c"') && line1.includes('"Jrnl"')) {
            const match1 = line1.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"Profit & Loss A\/c","","Jrnl",(-?[0-9,]+(?:\.[0-9]+)?),,/);
            
            if (match1) {
              const profitAmount = Math.abs(parseFloat(match1[2].replace(/,/g, '')));
              const date = match1[1];
              const year = '20' + date.split('-')[2];
              
              profitEntries.push({
                date,
                amount: profitAmount,
                type: 'Annual Profit (FY)',
                year,
                source: 'Official Tally P&L Journal Entry',
                rawEntry: line1.trim()
              });
              
              console.log('[CHAT] Found FY profit entry:', { date, amount: profitAmount, year, rawEntry: line1.trim() });
            }
          }
        }
      }
      
      // Return official P&L entries if found (deduplicate by raw entry)
      if (profitEntries.length > 0) {
        // Deduplicate entries based on rawEntry content
        const uniqueEntries = [];
        const seenEntries = new Set();
        
        for (const entry of profitEntries) {
          if (!seenEntries.has(entry.rawEntry)) {
            seenEntries.add(entry.rawEntry);
            uniqueEntries.push(entry);
          }
        }
        
        const totalProfit = uniqueEntries.reduce((sum, entry) => sum + entry.amount, 0);
        
        const profitSummary = `\n\n=== OFFICIAL TALLY FY PROFIT ===\n` +
          `TOTAL PROFIT: ₹${totalProfit.toLocaleString()}\n\n` +
          `PROFIT ENTRIES FOUND (${uniqueEntries.length} unique entries, ${profitEntries.length} total found):\n` +
          uniqueEntries.map(e => `- ${e.date}: ₹${e.amount.toLocaleString()} [${e.type}]\n  Raw Entry: ${e.rawEntry}`).join('\n\n') +
          `\n\nNOTE: This is the official Tally P&L journal entry:\n` +
          `• Found using pattern: ${marchPattern},"Profit & Loss A/c","","Jrnl"\n` +
          `• Represents Tally's calculated profit figure for the financial year\n` +
          `• OPTIMIZED: Searched only specific March chunks\n` +
          `• Matches CA/Auditor methodology for profit reporting\n` +
          `=== END OFFICIAL FY PROFIT ===\n`;
        
        console.log('[CHAT] Returning official FY P&L journal entries (OPTIMIZED):', { 
          totalProfit, 
          entriesFound: profitEntries.length,
          uniqueEntries: uniqueEntries.length,
          optimization: 'Used March-only search for FY queries'
        });
        
        // Generate AI response with P&L context
        const aiPrompt = `You are a financial analyst. The user asked: "${question}"

Here is the official Tally FY P&L data found:
${profitSummary}

Provide a clear, professional response about the FY profit figures. Focus only on the official P&L journal entries provided. Do not fabricate or estimate any additional data.`;
        
        try {
          const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: process.env.OPENAI_MODEL || 'gpt-4o',
              messages: [{ role: 'user', content: aiPrompt }],
              max_tokens: 1500,
              temperature: 0.2
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          const aiAnswer = openaiResponse.data.choices[0].message.content || profitSummary;
          console.log('[CHAT] AI response generated for FY P&L entries');
          return res.json({ answer: aiAnswer });
        } catch (error) {
          console.error('[CHAT] OpenAI API error for FY P&L entries:', error);
          return res.json({ answer: profitSummary });
        }
      } else {
        console.log('[CHAT] No FY P&L journal entries found, falling back to traditional calculation');
      }
    }
    
    // Deterministic precomputation: FY sales calculation (optimized)
    if (queryType === 'fy_sales' && dateContext && dateContext.isDateSpecific) {
      console.log('[CHAT] FY Sales query detected - using optimized FY date filtering');
      
      // Extract FY years from query to determine date range
      // FY 2022-23 → Apr 2022 to Mar 2023, FY 2023-24 → Apr 2023 to Mar 2024
      let startYear = null;
      let endYear = null;
      const fyMatch = question.match(/(?:fy|financial\s*year)?\s*(\d{4})[-\/\s]?(\d{2,4})/i);
      if (fyMatch) {
        startYear = fyMatch[1];
        const endYearStr = fyMatch[2];
        endYear = endYearStr.length === 2 ? '20' + endYearStr : endYearStr;
        console.log('[CHAT] FY detected:', startYear + '-' + fyMatch[2], '→ Date range: Apr', startYear, 'to Mar', endYear);
      }
      
      if (startYear && endYear) {
        // Create FY date range: Apr startYear to Mar endYear
        const fyStartDate = new Date(parseInt(startYear), 3, 1); // April 1st
        const fyEndDate = new Date(parseInt(endYear), 2, 31); // March 31st
        
        console.log('[CHAT] FY Sales date range:', fyStartDate.toDateString(), 'to', fyEndDate.toDateString());
        
        // Extract sales entries within FY date range using same logic as extractSalesFromText
        const salesEntries = [];
        const monthAbbrevs = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        
        console.log('[CHAT] Processing', dateFilteredChunks.length, 'chunks for FY sales extraction');
        
        for (const chunk of dateFilteredChunks) {
          const content = chunk.content || '';
          const lines = content.split(/\r?\n/);
          let chunkSalesCount = 0;
          
          for (const line of lines) {
            if (!line.includes('"Sale"')) continue;
            
            // Use same regex patterns as extractSalesFromText function
            const lineRegexA = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","Sale",(-?[0-9,.-]+)\b.*$/;
            const lineRegexB = /^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","","Sale",,(-?[0-9,.-]+)\b.*$/;
            
            let salesMatch = lineRegexA.exec(line);
            if (!salesMatch) salesMatch = lineRegexB.exec(line);
            
            if (salesMatch) {
              const dateStr = salesMatch[1];
              const account = salesMatch[2] || '';
              let amtRaw = salesMatch[3];
              
              // Handle Indian number formatting: -47,39,65 should become 473965
              amtRaw = amtRaw.replace(/[,-]/g, '');
              const amount = parseFloat(amtRaw);
              
              if (amount > 0) { // Only positive amounts for sales
                // Parse date components
                const dateMatch = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
                if (dateMatch) {
                  const day = parseInt(dateMatch[1]);
                  const monthAbbr = dateMatch[2];
                  const year = parseInt('20' + dateMatch[3]);
                  
                  // Create date for comparison
                  const monthIndex = monthAbbrevs.indexOf(monthAbbr);
                  if (monthIndex !== -1) {
                    const entryDate = new Date(year, monthIndex, day);
                    
                    // Check if entry falls within FY range
                    if (entryDate >= fyStartDate && entryDate <= fyEndDate) {
                      const key = `${dateStr}|${account}|${amount}`;
                      
                      salesEntries.push({
                        date: dateStr,
                        account,
                        amount,
                        key,
                        sortDate: entryDate
                      });
                      chunkSalesCount++;
                    }
                  }
                }
              }
            }
          }
          
          if (chunkSalesCount > 0) {
            // Get month breakdown for this chunk
            const chunkMonths = {};
            for (const entry of salesEntries.slice(-chunkSalesCount)) {
              const monthMatch = entry.date.match(/-([A-Za-z]{3})-/);
              if (monthMatch) {
                const month = monthMatch[1];
                chunkMonths[month] = (chunkMonths[month] || 0) + 1;
              }
            }
            const monthDetails = Object.entries(chunkMonths).map(([month, count]) => `${month}:${count}`).join(', ');
            console.log('[CHAT] Found', chunkSalesCount, 'FY sales entries in chunk from', chunk.fileName || 'Unknown file', '(Months:', monthDetails + ')');
          }
        }
        
        console.log('[CHAT] Total FY sales entries found before deduplication:', salesEntries.length);
        
        // Deduplicate and sort
        const uniqueEntries = [];
        const seenKeys = new Set();
        
        for (const entry of salesEntries) {
          if (!seenKeys.has(entry.key)) {
            seenKeys.add(entry.key);
            uniqueEntries.push(entry);
          }
        }
        
        // Sort by date
        uniqueEntries.sort((a, b) => a.sortDate - b.sortDate);
        
        // Calculate total and month-wise breakdown
        const totalSales = uniqueEntries.reduce((sum, entry) => sum + entry.amount, 0);
        const monthWiseBreakdown = {};
        
        for (const entry of uniqueEntries) {
          const monthMatch = entry.date.match(/-([A-Za-z]{3})-/);
          if (monthMatch) {
            const month = monthMatch[1];
            if (!monthWiseBreakdown[month]) {
              monthWiseBreakdown[month] = { count: 0, total: 0 };
            }
            monthWiseBreakdown[month].count++;
            monthWiseBreakdown[month].total += entry.amount;
          }
        }
        
        console.log('[CHAT] Month-wise FY sales breakdown:', monthWiseBreakdown);
        console.log('[CHAT] Returning official FY Sales (OPTIMIZED):', {
          totalSales,
          entriesFound: uniqueEntries.length,
          fyPeriod: startYear + '-' + fyMatch[2],
          optimization: 'Used FY-specific date filtering'
        });
        
        // Create detailed voucher listing for AI response
        const voucherListing = uniqueEntries.map(entry => 
          `${entry.date}: ${entry.account} - ₹${entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ).join('\n');
        
        const monthWiseSummary = Object.entries(monthWiseBreakdown)
          .map(([month, data]) => `${month}: ${data.count} entries, ₹${data.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
          .join('\n');
        
        // Generate AI response with OpenAI
        const prompt = `You are a financial analyst reviewing official Tally sales data for FY ${startYear}-${fyMatch[2]}.

OFFICIAL SALES SUMMARY:
- Total Sales: ₹${totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Number of Sales Entries: ${uniqueEntries.length}
- Financial Year Period: April ${startYear} to March ${endYear}
- Data Source: Official Tally accounting records

MONTH-WISE BREAKDOWN:
${monthWiseSummary}

COMPLETE VOUCHER LISTING (Chronological Order):
${voucherListing}

This data represents verified sales transactions extracted from the company's official accounting system for the specified financial year period.

Provide a comprehensive analysis including:
1. Total sales amount and number of entries
2. Month-wise performance highlights
3. Complete chronological listing of all sales vouchers
4. Professional summary of the FY performance

Format the response professionally with proper Indian currency formatting and clear section headings.`;

        try {
          const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2
          }, {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });

          console.log('[CHAT] AI response generated for FY Sales entries with complete voucher listing');
          return res.json({
            response: response.data.choices[0].message.content,
            metadata: {
              totalSales,
              entriesFound: uniqueEntries.length,
              fyPeriod: startYear + '-' + fyMatch[2],
              queryType: 'fy_sales',
              optimization: 'FY-specific filtering applied',
              monthWiseBreakdown
            }
          });
        } catch (error) {
          console.error('[CHAT] OpenAI API error:', error.message);
          
          // Fallback response with complete details
          const fallbackResponse = `# FY ${startYear}-${fyMatch[2]} Sales Analysis

## Summary
Total sales for FY ${startYear}-${fyMatch[2]}: **₹${totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**
Number of sales entries: **${uniqueEntries.length}**
Period: April ${startYear} to March ${endYear}

## Month-wise Breakdown
${monthWiseSummary}

## Complete Sales Voucher Listing
${voucherListing}

This comprehensive analysis is based on official Tally accounting records with FY-specific filtering applied.`;
          
          return res.json({
            response: fallbackResponse,
            metadata: {
              totalSales,
              entriesFound: uniqueEntries.length,
              fyPeriod: startYear + '-' + fyMatch[2],
              queryType: 'fy_sales',
              optimization: 'FY-specific filtering applied',
              monthWiseBreakdown
            }
          });
        }
      }
      let totalExpenses = 0;
      const revenueEntries = [];
      const expenseEntries = [];
      
      // Balance sheet exclusion keywords - more comprehensive
      const balanceSheetKeywords = [
        'loan', 'advance', 'capital', 'investment', 'asset', 'machinery', 'furniture',
        'equipment', 'building', 'land', 'vehicle', 'computer', 'deposit', 'security',
        'refund', 'customer advance', 'security deposit', 'bank', 'transfer', 'incorporation',
        'marble block', 'inventory', 'stock', 'goods', 'material', 'raw material'
      ];
      
      const isBalanceSheetItem = (account) => {
        const lowerAccount = account.toLowerCase();
        return balanceSheetKeywords.some(keyword => lowerAccount.includes(keyword)) ||
               lowerAccount.includes('bank') && (lowerAccount.includes('transfer') || lowerAccount.includes('to ')) ||
               // Exclude large amounts that are likely capital/asset transactions
               lowerAccount.includes('marble') || lowerAccount.includes('block') ||
               lowerAccount.includes('incorporation') || lowerAccount.includes('llp');
      };
      
      const isReceiptIncome = (account) => {
        const lowerAccount = account.toLowerCase();
        const incomeKeywords = ['sales', 'service', 'commission', 'interest', 'dividend', 'rental', 'misc income'];
        const excludeKeywords = ['advance', 'deposit', 'refund', 'return'];
        
        return incomeKeywords.some(keyword => lowerAccount.includes(keyword)) &&
               !excludeKeywords.some(keyword => lowerAccount.includes(keyword));
      };
      
      // Helper function to check if a date matches the query context
      const isDateInQueryRange = (dateStr) => {
        if (!dateContext.isDateSpecific) return true;
        
        // Parse the date from format "DD-MMM-YY"
        const dateMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
        if (!dateMatch) {
          console.log('[CHAT] Date parsing failed for:', dateStr);
          return false;
        }
        
        const [, day, monthAbbr, year] = dateMatch;
        const fullYear = '20' + year;
        
        // Check if this date matches the query context
        if (dateContext.months.length > 0 && dateContext.years.length > 0) {
          const monthMatches = dateContext.months.some(m => 
            m.toLowerCase().slice(0, 3) === monthAbbr.toLowerCase()
          );
          const yearMatches = dateContext.years.some(y => 
            fullYear === y || year === y.slice(-2)
          );
          
          const matches = monthMatches && yearMatches;
          console.log('[CHAT] Date check:', dateStr, 'Month match:', monthMatches, 'Year match:', yearMatches, 'Final:', matches);
          return matches;
        }
        
        return true;
      };
      
      for (const chunk of dateFilteredChunks) {
        const lines = chunk.content.split('\n');
        for (const line of lines) {
          // REVENUE: Sales vouchers (Type: "Sale")
          if (line.includes('"Sale"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","Sale"[^,]*,(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && isDateInQueryRange(dateStr)) {
                totalRevenue += amount;
                revenueEntries.push({ date: dateStr, account, amount, type: 'Sales' });
              }
            }
          }
          
          // REVENUE: Credit Notes (Type: "C/Note" - treated as sales returns, subtract from revenue)
          if (line.includes('"C/Note"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","C\/Note"[^,]*,(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && isDateInQueryRange(dateStr)) {
                totalRevenue -= amount; // Subtract credit notes as they represent sales returns
                revenueEntries.push({ date: dateStr, account, amount: -amount, type: 'Sales Return (Credit Note)' });
              }
            }
          }
          
          // REVENUE: Income receipts (Type: "Rcpt" - only genuine business income)
          if (line.includes('"Rcpt"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","Rcpt"[^,]*,(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && isReceiptIncome(account) && isDateInQueryRange(dateStr)) {
                totalRevenue += amount;
                revenueEntries.push({ date: dateStr, account, amount, type: 'Business Income Receipt' });
              }
            }
          }
          
          // EXPENSES: Purchase costs (Type: "Purc" - only trading goods, not assets)
          if (line.includes('"Purc"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","Purc"[^,]*,(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              const lowerAccount = account.toLowerCase();
              
              // Exclude asset purchases and large inventory acquisitions
              const assetKeywords = ['marble block', 'machinery', 'equipment', 'furniture', 'vehicle', 'computer'];
              const isAssetPurchase = assetKeywords.some(keyword => lowerAccount.includes(keyword));
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && !isAssetPurchase && isDateInQueryRange(dateStr)) {
                totalExpenses += amount;
                expenseEntries.push({ date: dateStr, account, amount, type: 'Purchase (COGS)' });
              }
            }
          }
          
          // EXPENSES: Operating payments (Type: "Pymt" - only small business expenses)
          if (line.includes('"Pymt"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","Pymt",(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              const lowerAccount = account.toLowerCase();
              
              // Only include payments that are clearly operating expenses and under reasonable limits
              const operatingExpenseKeywords = [
                'electricity', 'rent', 'salary', 'wage', 'tax', 'insurance', 'telephone',
                'internet', 'office', 'stationery', 'courier', 'freight', 'bank charges',
                'professional', 'audit', 'legal', 'maintenance', 'repair', 'fuel',
                'travel', 'conveyance', 'advertisement', 'marketing'
              ];
              
              const isOperatingExpense = operatingExpenseKeywords.some(keyword => lowerAccount.includes(keyword));
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && isOperatingExpense && amount < 500000 && isDateInQueryRange(dateStr)) {
                totalExpenses += amount;
                expenseEntries.push({ date: dateStr, account, amount, type: 'Operating Payment' });
              }
            }
          }
          
          // EXPENSES: Operating expenses from Journal entries (Type: "Jrnl")
          if (line.includes('"Jrnl"')) {
            const match = line.match(/^(\d{1,2}-[A-Za-z]{3}-\d{2}),"([^"]*)","[^"]*","Jrnl",(-?[0-9,]+(?:\.[0-9]+)?)/);
            if (match) {
              const dateStr = match[1];
              const amount = Math.abs(parseFloat(match[3].replace(/,/g, '')));
              const account = match[2];
              
              // Include journal entries that are operating expenses (rent, salaries, utilities, etc.)
              const expenseKeywords = [
                'rent', 'salary', 'expense', 'electricity', 'insurance', 'professional', 'tax', 
                'charges', 'freight', 'custom', 'duty', 'courier', 'travel', 'office', 'telephone',
                'internet', 'maintenance', 'repair', 'audit', 'legal', 'consulting', 'advertising',
                'marketing', 'commission', 'brokerage', 'penalty', 'fine', 'miscellaneous'
              ];
              const excludeJournalKeywords = [
                'interest on loan', 'depreciation', 'provision', 'capital', 'advance', 'loan',
                'marble', 'block', 'inventory', 'stock', 'asset', 'investment', 'incorporation',
                'profit & loss', 'profit retained' // Exclude P&L transfer entries
              ];
              const isExpense = expenseKeywords.some(keyword => account.toLowerCase().includes(keyword)) &&
                              !excludeJournalKeywords.some(keyword => account.toLowerCase().includes(keyword)) &&
                              amount < 200000; // Limit journal expenses to reasonable amounts
              
              // Only include if date matches query range
              if (!isNaN(amount) && !isBalanceSheetItem(account) && isExpense && isDateInQueryRange(dateStr)) {
                totalExpenses += amount;
                expenseEntries.push({ date: dateStr, account, amount, type: 'Operating Expense (Journal)' });
              }
            }
          }
        }
      }
      
      const netProfit = totalRevenue - totalExpenses;
      
      profitSummary = `\n\n=== ACCOUNTING PROFIT CALCULATION ===\n` +
        `TOTAL REVENUE (Sales + Other Income): ${totalRevenue.toLocaleString()}\n` +
        `TOTAL EXPENSES (Purchases + Operating Expenses): ${totalExpenses.toLocaleString()}\n` +
        `NET PROFIT/LOSS: ${netProfit.toLocaleString()}\n\n` +
        `REVENUE BREAKDOWN (${revenueEntries.length} entries):\n` +
        revenueEntries.slice(0, 15).map(e => `- ${e.date}: ${e.account} = ₹${e.amount.toLocaleString()} [${e.type}]`).join('\n') +
        (revenueEntries.length > 15 ? `\n... and ${revenueEntries.length - 15} more revenue entries` : '') +
        `\n\nEXPENSE BREAKDOWN (${expenseEntries.length} entries):\n` +
        expenseEntries.slice(0, 15).map(e => `- ${e.date}: ${e.account} = ₹${e.amount.toLocaleString()} [${e.type}]`).join('\n') +
        (expenseEntries.length > 15 ? `\n... and ${expenseEntries.length - 15} more expense entries` : '') +
        `\n\nNOTE: This calculation follows proper accounting principles:\n` +
        `• REVENUE: Sales (net of returns), genuine business income receipts\n` +
        `• EXPENSES: Trading purchases, operating payments (<5L), business journals (<2L)\n` +
        `• EXCLUDED: Loans, advances, assets, inventory, large transactions, bank transfers\n` +
        `• Credit Notes treated as sales returns (subtracted from revenue)\n` +
        `• Amount limits applied to prevent inclusion of capital transactions\n` +
        `=== END PROFIT CALCULATION ===\n`;
      
      console.log('[CHAT] Computed profit (updated logic):', { 
        revenue: totalRevenue, 
        expenses: totalExpenses, 
        profit: netProfit,
        revenueEntries: revenueEntries.length,
        expenseEntries: expenseEntries.length 
      });
      
      // Debug: Show sample entries that were included
      console.log('[CHAT] Sample revenue entries included:');
      revenueEntries.slice(0, 5).forEach(e => {
        console.log(`  ${e.date}: ${e.account} = ₹${e.amount.toLocaleString()} [${e.type}]`);
      });
      
      console.log('[CHAT] Sample expense entries included:');
      expenseEntries.slice(0, 10).forEach(e => {
        console.log(`  ${e.date}: ${e.account} = ₹${e.amount.toLocaleString()} [${e.type}]`);
      });
    }
    
    // Create data summary for validation
    const dataSummary = createDataSummary(dateFilteredChunks);
    console.log('[CHAT] Data summary:', {
      totalVouchers: dataSummary.totalVouchers,
      voucherTypes: Object.keys(dataSummary.voucherTypes),
      dateRange: dataSummary.dateRange,
      purchaseEntries: dataSummary.purchaseEntries,
      bankEntries: dataSummary.bankEntries
    });
    
    // Embed the enhanced question
    const queryEmbedding = await getEmbedding(enhancedQuestion);
    console.log('[CHAT] Query embedding generated for enhanced question.');

    // Find most relevant data chunks using enhanced vector search
    // For date-specific queries, get more chunks to ensure complete coverage
    const vectorSearchLimit = dateContext && dateContext.isDateSpecific ? Math.min(dateFilteredChunks.length, 50) : 20;
    const topChunks = findMostSimilarChunks(queryEmbedding, dateFilteredChunks, question, vectorSearchLimit);
    console.log('[CHAT] Enhanced vector search completed. Found', topChunks.length, 'relevant chunks (limit:', vectorSearchLimit, ')');
    
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
    
    // Smart chunk selection: prioritize by relevance score and use ALL matched chunks (no slicing)
    const sortedChunks = combinedChunks.sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA; // Higher scores first
    });
    
    console.log('[CHAT] Matched chunks (after dedupe):', sortedChunks.length);
    console.log('[CHAT] Example of top matched chunks (up to 5 shown):');
    sortedChunks.slice(0, 5).forEach((c, i) => {
      const content = c.content || (c._doc && c._doc.content);
      const fileName = c.fileName || 'Unknown file';
      if (typeof content === 'string') {
        console.log(`  Chunk ${i+1} [${fileName}]: ${content.substring(0, 100)}...`);
      } else {
        console.log(`  Chunk ${i+1} [${fileName}]: [No content]`, c);
      }
    });
    
    // Log which files are being used in the response
    const filesUsed = [...new Set(sortedChunks.map(c => c.fileName))];
    console.log('[CHAT] Files being used in response:', filesUsed.join(', '));

    // Condense content per chunk based on query type/keywords
    const queryKeywords = buildQueryKeywords(question, queryType, bankName);
    const condensedChunks = sortedChunks.map((chunk) => {
      const content = chunk.content || (chunk._doc && chunk._doc.content) || '';
      const condensed = condenseContentByKeywords(content, queryKeywords, {
        maxLines: 120,
        linesBefore: 0,
        linesAfter: 0,
        maxCharsFallback: 800
      });
      return { ...chunk, condensed };
    });

    // Reorder to guarantee date coverage for month-specific queries: first include one chunk per distinct day, then remaining by relevance
    let finalOrderedChunks = condensedChunks;
    if (dateContext && dateContext.isDateSpecific && dateContext.months && dateContext.months.length > 0) {
      // Build month tokens like 'Oct' from dateContext; prefer abbreviated month forms
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        dateContext.months
          .map(m => m.toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2))); // match YY format

      const daySeen = new Set();
      const perDayFirst = [];
      const rest = [];

      const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
      for (const ch of condensedChunks) {
        const text = ch.condensed || '';
        const m = dateRegex.exec(text);
        if (m) {
          const day = m[1];
          const mon = m[2].toLowerCase();
          const yy = m[3];
          const monthOk = wantedMonths.size === 0 || wantedMonths.has(mon);
          const yearOk = wantedYears.size === 0 || wantedYears.has(yy);
          if (monthOk && yearOk) {
            const key = `${yy}-${mon}-${day.padStart(2,'0')}`;
            if (!daySeen.has(key)) {
              daySeen.add(key);
              perDayFirst.push(ch);
              continue;
            }
          }
        }
        rest.push(ch);
      }
      // Preserve original order: per-day coverage first, then remaining
      finalOrderedChunks = [...perDayFirst, ...rest];
      console.log('[CHAT] Per-day coverage selected', perDayFirst.length, 'unique day chunks for month query.');
    }

    // Build enhanced context using final ordered chunks
    // For date-specific queries, include ALL chunks to ensure complete coverage
    const isDateSpecificQuery = dateContext && dateContext.isDateSpecific;
    const MAX_CONTEXT_CHARS = isDateSpecificQuery ? 50000 : 16000; // Higher limit for date queries
    
    let running = '';
    let countIncluded = 0;
    for (let i = 0; i < finalOrderedChunks.length; i += 1) {
      const chunk = finalOrderedChunks[i];
      const fileName = chunk.fileName || 'Unknown file';
      const score = chunk.score ? ` (relevance: ${chunk.score.toFixed(3)})` : '';
      const piece = `[CHUNK ${i + 1} - From: ${fileName}${score}]\n${chunk.condensed}\n\n`;
      
      // For date-specific queries, be more generous with context inclusion
      if (!isDateSpecificQuery && (running.length + piece.length) > MAX_CONTEXT_CHARS) break;
      if (isDateSpecificQuery && (running.length + piece.length) > MAX_CONTEXT_CHARS) {
        // For date queries, try to include at least 80% of chunks even if over limit
        const minChunksToInclude = Math.floor(finalOrderedChunks.length * 0.8);
        if (countIncluded < minChunksToInclude) {
          running += piece;
          countIncluded += 1;
          continue;
        } else {
          break;
        }
      }
      
      running += piece;
      countIncluded += 1;
    }
    const context = running;
    console.log('[CHAT] Condensed context included', countIncluded, 'of', finalOrderedChunks.length, 'matched chunks. Total context chars:', context.length);
    console.log('[CHAT] Date-specific query:', isDateSpecificQuery, '- Used higher context limit:', MAX_CONTEXT_CHARS);

    // Add validation context
    let validationContext = `
DATA VALIDATION SUMMARY:
- Total vouchers available: ${dataSummary.totalVouchers}
- Voucher types found: ${Object.keys(dataSummary.voucherTypes).join(', ')}
- Date range: ${dataSummary.dateRange.min ? dataSummary.dateRange.min.toDateString() : 'N/A'} to ${dataSummary.dateRange.max ? dataSummary.dateRange.max.toDateString() : 'N/A'}
- Total debit amount: ${dataSummary.totalDebit.toLocaleString()}
- Total credit amount: ${dataSummary.totalCredit.toLocaleString()}
- Purchase entries found: ${dataSummary.purchaseEntries}
- Banks mentioned: ${dataSummary.bankEntries.join(', ')}
`;

    // Add enhanced validation context for specific query types
    if (queryType === 'purchase') {
      const purchaseEntries = extractPurchaseEntries(allDataChunks);
      const purchaseValidation = validatePurchaseEntries(purchaseEntries);
      validationContext += `
PURCHASE VALIDATION DETAILS:
- Total purchase entries: ${purchaseValidation.total}
- Entry types found: ${Object.keys(purchaseValidation.byType).join(', ')}
- Completeness score: ${purchaseValidation.completeness.toFixed(1)}%
- Files with purchase data: ${Object.keys(purchaseValidation.byFile).join(', ')}
- Suggestions: ${purchaseValidation.suggestions.join('; ')}
`;
    }

    if (bankName) {
      const bankEntries = extractBankSpecificEntries(allDataChunks, bankName);
      const bankValidation = validateBankEntries(bankEntries, bankName);
      validationContext += `
BANK VALIDATION DETAILS (${bankName.toUpperCase()}):
- Total ${bankName} entries: ${bankValidation.total}
- Exact matches: ${bankValidation.exactMatches}
- Variation matches: ${bankValidation.variationMatches}
- Accuracy score: ${bankValidation.accuracy.toFixed(1)}%
- Suggestions: ${bankValidation.suggestions.join('; ')}
`;
    }

    // Special handling: interest on secured loans (captures JRNL and bank-specific cases)
    const isInterestSecuredLoanQuery = /interest on (secured )?loan|secured loan interest|loan interest/i.test(question);
    let interestEntriesSummary = '';
    if (isInterestSecuredLoanQuery) {
      const requireJournal = /\b(jrnl|journal)\b/i.test(question);
      const bankFromQuery = detectBankQuery(question); // returns normalized bank key if found
      const interestEntries = extractInterestOnSecuredLoans(allDataChunks, dateContext, bankFromQuery, requireJournal);

      if (interestEntries.length > 0) {
        const total = interestEntries.reduce((s, e) => s + (e.amount || 0), 0);
        const byBank = {};
        interestEntries.forEach(e => {
          const key = (e.account || 'unknown').toLowerCase();
          byBank[key] = (byBank[key] || 0) + (e.amount || 0);
        });
        const top5 = Object.entries(byBank).slice(0, 5).map(([k, v]) => `- ${k}: ${v.toLocaleString()}`).join('\n');

        interestEntriesSummary = `\n\nPRECOMPUTED INTEREST-ON-SECURED-LOAN SUMMARY:\n- Entries found: ${interestEntries.length}\n- Total interest amount: ${total.toLocaleString()}\n- Top accounts by interest:\n${top5}\n`;

        // Also add a compact table-like list for the model
        const sample = interestEntries.slice(0, 15).map(e => `- ${e.date} | ${e.type} | ${e.account} | ${e.narration} | Amt: ${e.amount.toLocaleString()} | File: ${e.fileName}`).join('\n');
        interestEntriesSummary += `\nSample entries:\n${sample}\n`;
      } else {
        interestEntriesSummary = `\n\nPRECOMPUTED INTEREST-ON-SECURED-LOAN SUMMARY:\n- No matching entries found with filters (JRNL=${requireJournal ? 'yes' : 'no'}, Bank=${bankFromQuery || 'any'})\n`;
      }
    }

    // Deterministic precomputation: purchases for month/year queries
    let purchaseSummary = '';
    if (queryType === 'purchase' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      const entries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = extractPurchasesFromText(text, wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) entries.push(...found);
      }
      const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
      const sample = entries.slice(0, 25)
        .map(e => `- ${e.date} | ${e.account} | Amt: ${e.amount.toLocaleString()} | File: ${e.fileName}`)
        .join('\n');
      purchaseSummary = `\n\nPRECOMPUTED PURCHASE SUMMARY (Deterministic):\n- Entries found: ${entries.length}\n- Total purchases: ${total.toLocaleString()}\nSample entries:\n${sample}\n`;
      console.log('[CHAT] Precomputed purchases (date-filtered scan):', { count: entries.length, total });
    }

    // Individual ledger search handling
    let ledgerSummary = '';
    if (queryType === 'ledger' && ledgerContext.isLedgerQuery) {
      console.log('[CHAT] Processing individual ledger query for:', ledgerContext.matchedLedgers.map(l => l.name));
      
      const ledgerEntries = [];
      
      // Special handling for profit queries - prioritize "Profit & Loss A/c"
      let topLedger = ledgerContext.matchedLedgers[0];
      if (/\b(profit|loss|p&l|pnl)\b/i.test(question)) {
        const profitLossLedger = ledgerContext.matchedLedgers.find(ledger => 
          /profit\s*&\s*loss\s*a\/c/i.test(ledger.name)
        );
        if (profitLossLedger) {
          topLedger = profitLossLedger;
          console.log('[CHAT] Profit query detected - prioritizing Profit & Loss A/c over other matches');
        }
      }
      
      // For exact matching, prioritize the full ledger name first
      const searchKeywords = [topLedger.name.toLowerCase()];
      console.log('[CHAT] Using exact match for top ledger:', topLedger.name, 'Keywords:', searchKeywords);
      
      // Search for transactions involving the matched ledgers
      console.log('[CHAT] Searching in', dateFilteredChunks.length, 'date-filtered chunks for:', searchKeywords);
      let totalLinesProcessed = 0;
      let matchingLines = 0;
      
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const lines = text.split(/\r?\n/);
        totalLinesProcessed += lines.length;
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Check if line contains any of the ledger keywords (exact match)
          const hasLedgerKeyword = searchKeywords.some(keyword => 
            line.toLowerCase().includes(keyword.toLowerCase())
          );
          
          if (hasLedgerKeyword) {
            matchingLines++;
            console.log('[CHAT] Found matching line:', line.substring(0, 100) + '...');
            // Extract transaction details
            const dateRegex = /\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/;
            const dateMatch = dateRegex.exec(line);
            
            if (dateMatch) {
              const currentDate = dateMatch[0];
              const monthAbbr = dateMatch[2].toLowerCase();
              const year = dateMatch[3];
              
              // Apply date filtering if specified
              if (dateContext && dateContext.isDateSpecific) {
                // Special handling for Financial Year queries
                if (dateContext.specificDateRange && dateContext.specificDateRange.includes('FY')) {
                  const fyMatch = dateContext.specificDateRange.match(/FY\s*(\d{4})-(\d{2})/);
                  if (fyMatch) {
                    const startYear = parseInt(fyMatch[1]);
                    const endYearShort = fyMatch[2];
                    const endYear = parseInt('20' + endYearShort);
                    
                    // Convert current transaction date to comparable format
                    const currentYear = parseInt('20' + year);
                    const monthIndex = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(monthAbbr);
                    
                    // FY 2023-24 means Apr 2023 to Mar 2024
                    let isInFY = false;
                    if (currentYear === startYear && monthIndex >= 3) { // Apr-Dec of start year
                      isInFY = true;
                    } else if (currentYear === endYear && monthIndex <= 2) { // Jan-Mar of end year
                      isInFY = true;
                    }
                    
                    if (!isInFY) {
                      console.log(`[CHAT] Excluding transaction outside FY ${dateContext.specificDateRange}: ${currentDate} (Year: ${currentYear}, Month: ${monthAbbr})`);
                      continue;
                    } else {
                      console.log(`[CHAT] Including FY transaction: ${currentDate} (Year: ${currentYear}, Month: ${monthAbbr})`);
                    }
                  }
                } else {
                  // Regular date filtering for non-FY queries
                  const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
                  const wantedMonths = new Set(
                    (dateContext.months || [])
                      .map(m => String(m).toLowerCase().slice(0,3))
                      .filter(m => monthAbbrevs.includes(m))
                  );
                  const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));
                  
                  const monthOk = wantedMonths.size === 0 || wantedMonths.has(monthAbbr);
                  const yearOk = wantedYears.size === 0 || wantedYears.has(year);
                  
                  if (!monthOk || !yearOk) continue;
                }
              }
              
              // Parse CSV fields to extract account and amount
              const fields = line.split(',');
              if (fields.length >= 5) {
                const accountField = fields[1].replace(/^"|"$/g, '').trim();
                const voucherType = fields[3].replace(/^"|"$/g, '').trim();
                
                // Extract amounts from debit/credit columns
                let amount = 0;
                let transactionType = 'unknown';
                
                // Check Amount1 field (field 4) and Amount2 field (field 5)
                const amount1Field = fields[4].replace(/^"|"$/g, '').trim();
                const amount2Field = fields[5] ? fields[5].replace(/^"|"$/g, '').trim() : '';
                
                if (amount1Field && amount1Field.match(/^-?[0-9,.]+$/)) {
                  const amt1 = parseFloat(amount1Field.replace(/[,-]/g, ''));
                  if (!isNaN(amt1)) {
                    amount = amt1;
                    transactionType = amt1 < 0 ? 'debit' : 'credit';
                  }
                }
                
                if (amount2Field && amount2Field.match(/^-?[0-9,.]+$/)) {
                  const amt2 = parseFloat(amount2Field.replace(/[,-]/g, ''));
                  if (!isNaN(amt2) && Math.abs(amt2) > Math.abs(amount)) {
                    amount = amt2;
                    transactionType = amt2 < 0 ? 'debit' : 'credit';
                  }
                }
                
                if (amount !== 0) {
                  ledgerEntries.push({
                    date: currentDate,
                    account: accountField,
                    amount: Math.abs(amount),
                    transactionType: transactionType,
                    voucherType: voucherType,
                    fileName: ch.fileName || 'Unknown file',
                    matchedKeywords: searchKeywords.filter(k => line.toLowerCase().includes(k.toLowerCase()))
                  });
                }
              }
            }
          }
        }
      }
      
      // Remove duplicates and sort by date
      const uniqueLedgerEntries = [];
      const seen = new Set();
      for (const entry of ledgerEntries) {
        const key = `${entry.date}|${entry.account}|${entry.amount}|${entry.transactionType}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueLedgerEntries.push(entry);
        }
      }
      
      // For sales queries, filter only "Sale" voucher types
      const isSalesQuery = question.toLowerCase().includes('sale');
      const isPurchaseQuery = question.toLowerCase().includes('purchase') || question.toLowerCase().includes('purc');
      
      if (isSalesQuery) {
        const salesEntries = uniqueLedgerEntries.filter(entry => entry.voucherType && entry.voucherType.toLowerCase() === 'sale');
        console.log(`[CHAT] Sales query detected - filtered from ${uniqueLedgerEntries.length} to ${salesEntries.length} transactions`);
        uniqueLedgerEntries.length = 0; // Clear original array
        uniqueLedgerEntries.push(...salesEntries); // Replace with sales only
      } else if (isPurchaseQuery) {
        const purchaseEntries = uniqueLedgerEntries.filter(entry => entry.voucherType && entry.voucherType.toLowerCase() === 'purc');
        console.log(`[CHAT] Purchase query detected - filtered from ${uniqueLedgerEntries.length} to ${purchaseEntries.length} transactions`);
        uniqueLedgerEntries.length = 0; // Clear original array
        uniqueLedgerEntries.push(...purchaseEntries); // Replace with purchases only
      }
      
      // Sort by date AFTER filtering (handle DD-MMM-YY format like "1-Jul-24")
      uniqueLedgerEntries.sort((a, b) => {
        const parseDate = (dateStr) => {
          if (!dateStr || dateStr === '') return new Date(0);
          
          const parts = dateStr.split('-');
          if (parts.length !== 3) return new Date(0);
          
          const day = parseInt(parts[0]);
          const monthStr = parts[1].toLowerCase();
          const year = parseInt('20' + parts[2]); // Convert 24 to 2024
          
          const monthMap = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
          };
          
          const month = monthMap[monthStr];
          if (month === undefined) {
            console.log(`[DATE_PARSE] Unknown month: "${monthStr}" in date: "${dateStr}"`);
            return new Date(0);
          }
          
          const parsedDate = new Date(year, month, day);
          return parsedDate;
        };
        
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return dateA - dateB;
      });
      
      // Log final sorted order for debugging
      console.log(`[DATE_SORT] Final chronological order (${uniqueLedgerEntries.length} transactions):`);
      uniqueLedgerEntries.forEach((entry, index) => {
        console.log(`  ${index + 1}. ${entry.date} | ${entry.account} | ₹${entry.amount.toLocaleString()} | ${entry.voucherType}`);
      });
      
      // Calculate totals
      const totalDebits = uniqueLedgerEntries.filter(e => e.transactionType === 'debit').reduce((s, e) => s + e.amount, 0);
      const totalCredits = uniqueLedgerEntries.filter(e => e.transactionType === 'credit').reduce((s, e) => s + e.amount, 0);
      const netAmount = totalCredits - totalDebits;
      
      const fyNote = dateContext.specificDateRange ? `\n- Date Filter Applied: ${dateContext.specificDateRange} (Apr ${dateContext.years[0]} to Mar ${dateContext.years[1]})` : '';
      const salesNote = isSalesQuery ? `\n- Sales Filter Applied: Only "Sale" voucher types included` : '';
      const purchaseNote = isPurchaseQuery ? `\n- Purchase Filter Applied: Only "Purc" voucher types included` : '';
      
      // Show ALL transactions in chronological order (no limit for ledger queries)
      const entriesListing = uniqueLedgerEntries
        .map(e => `- ${e.date} | ${e.account} | ${e.transactionType.toUpperCase()}: ₹${e.amount.toLocaleString()} | ${e.voucherType}`)
        .join('\n');
      
      ledgerSummary = `\n\nPRECOMPUTED LEDGER SEARCH RESULTS:\n` +
        `- Primary Ledger: ${topLedger.name} (Score: ${topLedger.matchScore})\n` +
        `- Exact Match Search: "${topLedger.name}"${fyNote}${salesNote}${purchaseNote}\n` +
        `- Total Transactions Found: ${uniqueLedgerEntries.length}\n` +
        `- Total Debits: ₹${totalDebits.toLocaleString()}\n` +
        `- Total Credits: ₹${totalCredits.toLocaleString()}\n` +
        `- Net Amount: ₹${netAmount.toLocaleString()}\n\n` +
        `COMPLETE CHRONOLOGICAL TRANSACTION LISTING (All ${uniqueLedgerEntries.length} transactions):\n${entriesListing}\n` +
        `\n**IMPORTANT**: These transactions are sorted in PERFECT CHRONOLOGICAL ORDER and pre-filtered for the requested criteria. Use ONLY this data for your response.\n`;
      
      console.log('[CHAT] Ledger search completed:', {
        searchKeyword: searchKeywords[0],
        chunksSearched: dateFilteredChunks.length,
        totalLinesProcessed,
        matchingLines,
        rawEntries: ledgerEntries.length,
        uniqueTransactions: uniqueLedgerEntries.length,
        totalDebits: totalDebits.toLocaleString(),
        totalCredits: totalCredits.toLocaleString(),
        netAmount: netAmount.toLocaleString()
      });
      
      console.log('[CHAT] Sample transactions found:');
      uniqueLedgerEntries.slice(0, 10).forEach((entry, i) => {
        console.log(`  ${i+1}. ${entry.date} | ${entry.account} | ${entry.transactionType.toUpperCase()}: ₹${entry.amount.toLocaleString()} | ${entry.voucherType}`);
      });
    }

    // Deterministic precomputation: FY sales for FY-specific queries
    let salesSummary = '';
    if (queryType === 'fy_sales' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      let entries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = extractSalesFromText(text, wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) {
          console.log('[CHAT] Found', found.length, 'sales entries in chunk from', ch.fileName);
          console.log('[CHAT] Sample entries:', found.slice(0, 3).map(e => `${e.date}: ${e.account} = ${e.amount}`));
          entries.push(...found);
        }
      }
      
      // Debug: Check for duplicates and negative amounts
      console.log('[CHAT] Total entries before filtering:', entries.length);
      const positiveEntries = entries.filter(e => e.amount > 0);
      const negativeEntries = entries.filter(e => e.amount < 0);
      const zeroEntries = entries.filter(e => e.amount === 0);
      console.log('[CHAT] Positive amounts:', positiveEntries.length, 'Negative amounts:', negativeEntries.length, 'Zero amounts:', zeroEntries.length);
      
      // Remove duplicates based on date + account + amount
      const uniquePositiveEntries = [];
      const seen = new Set();
      for (const entry of positiveEntries) {
        const key = `${entry.date}|${entry.account}|${entry.amount}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniquePositiveEntries.push(entry);
        }
      }
      
      console.log('[CHAT] After deduplication:', uniquePositiveEntries.length, 'unique positive entries');
      
      // Debug: List all entries to see what's being found
      console.log('[CHAT] All sales entries found:');
      uniquePositiveEntries.forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.date}: ${entry.account} = ${entry.amount}`);
      });
      
      entries = uniquePositiveEntries;

      // Use original logic for extraction but Python for accurate total calculation
      let finalTotal = entries.reduce((s, e) => s + (e.amount || 0), 0); // Fallback calculation
      let pythonCalculationNote = '';
      
      try {
        console.log('[CHAT] Using Python for accurate sales total calculation for', dateContext.years?.[0] || 'unknown year', 'from', entries.length, 'entries...');
        const { calculateSalesTotals } = require('../utils/pythonCalculator');
        const pythonResult = await calculateSalesTotals(entries, dateContext);
        finalTotal = pythonResult.total_amount;
        pythonCalculationNote = ' (Python-calculated)';
        console.log('[CHAT] Python calculation for', dateContext.years?.[0] || 'unknown year', 'successful:', { total: finalTotal });
      } catch (error) {
        console.log('[CHAT] Python calculation failed, using fallback:', error.message);
        pythonCalculationNote = ' (Fallback calculation)';
      }

      // Create COMPLETE listing of ALL entries for AI to use
      const allEntriesText = entries
        .sort((a, b) => new Date(a.date.split('-').reverse().join('-')) - new Date(b.date.split('-').reverse().join('-')))
        .map((e, index) => `${index + 1}. ${e.date}: ${e.account} = ₹${e.amount.toLocaleString()}`)
        .join('\n');

      salesSummary = `\n\n=== COMPLETE SALES VOUCHER LIST ===\n` +
        `TOTAL: ${entries.length} vouchers, Amount: ₹${finalTotal.toLocaleString()}${pythonCalculationNote}\n\n` +
        `ALL SALES VOUCHERS FOUND:\n${allEntriesText}\n\n` +
        `**CRITICAL INSTRUCTION**: List ALL ${entries.length} vouchers above. Do NOT create fake examples.\n` +
        `Use ONLY the actual data provided. Each line above is a real voucher from the Tally file.\n` +
        `=== END COMPLETE LIST ===\n`;
      console.log('[CHAT] Precomputed sales (date-filtered scan with breakdown) generated.');
    }

    // Deterministic precomputation: cash balance for cash-related queries
    let cashBalanceSummary = '';
    if (queryType === 'cash_balance' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      let cashTransactions = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = extractCashTransactionsFromText(text, wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) {
          console.log('[CHAT] Found', found.length, 'cash transactions in chunk from', ch.fileName);
          cashTransactions.push(...found);
        }
      }

      // Remove duplicates based on date + account + amount
      const uniqueCashTransactions = [];
      const seen = new Set();
      for (const entry of cashTransactions) {
        const key = `${entry.date}|${entry.account}|${entry.amount}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCashTransactions.push(entry);
        }
      }

      console.log('[CHAT] After deduplication:', uniqueCashTransactions.length, 'unique cash transactions');

      // Calculate net cash balance
      const receipts = uniqueCashTransactions.filter(t => t.amount > 0);
      const payments = uniqueCashTransactions.filter(t => t.amount < 0);
      const totalReceipts = receipts.reduce((s, t) => s + t.amount, 0);
      const totalPayments = Math.abs(payments.reduce((s, t) => s + t.amount, 0));
      const netCashBalance = totalReceipts - totalPayments;

      // Group by account for detailed breakdown
      const byAccount = {};
      uniqueCashTransactions.forEach(t => {
        const account = t.account.toLowerCase();
        if (!byAccount[account]) {
          byAccount[account] = { receipts: 0, payments: 0, net: 0, count: 0 };
        }
        if (t.amount > 0) {
          byAccount[account].receipts += t.amount;
        } else {
          byAccount[account].payments += Math.abs(t.amount);
        }
        byAccount[account].net = byAccount[account].receipts - byAccount[account].payments;
        byAccount[account].count++;
      });

      // Create summary
      const sample = uniqueCashTransactions.slice(0, 20)
        .map(t => `- ${t.date} | ${t.account} | ${t.transactionType} | Amt: ${t.amount.toLocaleString()} | ${t.voucherType}`)
        .join('\n');

      const accountSummary = Object.entries(byAccount)
        .sort(([,a], [,b]) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 10)
        .map(([acc, data]) => `- ${acc}: Net ${data.net.toLocaleString()} (R: ${data.receipts.toLocaleString()}, P: ${data.payments.toLocaleString()})`)
        .join('\n');

      cashBalanceSummary = `\n\nPRECOMPUTED CASH BALANCE SUMMARY:\n- Total cash transactions: ${uniqueCashTransactions.length}\n- Total receipts: ${totalReceipts.toLocaleString()}\n- Total payments: ${totalPayments.toLocaleString()}\n- Net cash balance: ${netCashBalance.toLocaleString()}\n\nAccount-wise breakdown:\n${accountSummary}\n\nSample transactions:\n${sample}\n`;
      console.log('[CHAT] Precomputed cash balance:', { transactions: uniqueCashTransactions.length, receipts: totalReceipts, payments: totalPayments, net: netCashBalance });
    }

    // Enhanced expense handling: Custom Duty vs Major Expenses detection
    let customDutySummary = '';
    let majorExpenseSummary = '';
    
    if (queryType === 'expense' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      // Check if user specifically asks about Custom Duty
      const isCustomDutyQuery = question.toLowerCase().includes('custom duty') || 
                               question.toLowerCase().includes('customs') ||
                               question.toLowerCase().includes('indian customs');

      if (isCustomDutyQuery) {
        // Handle Custom Duty specific queries
        const customDutyEntries = [];
        for (const ch of dateFilteredChunks) {
          const text = ch.content || (ch._doc && ch._doc.content) || '';
          const found = extractCustomDutyFromText(text, wantedMonths, wantedYears)
            .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
          if (found.length) {
            console.log('[CHAT] Found', found.length, 'Custom Duty entries in chunk from', ch.fileName);
            customDutyEntries.push(...found);
          }
        }

        // Remove duplicates based on date + amount
        const uniqueCustomDutyEntries = [];
        const seenCustomDuty = new Set();
        for (const entry of customDutyEntries) {
          const key = `${entry.date}|${entry.amount}`;
          if (!seenCustomDuty.has(key)) {
            seenCustomDuty.add(key);
            uniqueCustomDutyEntries.push(entry);
          }
        }
        
        if (uniqueCustomDutyEntries.length > 0) {
          const totalCustomDuty = uniqueCustomDutyEntries.reduce((sum, entry) => sum + entry.amount, 0);
          const customDutyBreakdown = uniqueCustomDutyEntries
            .sort((a, b) => new Date(a.date.split('-').reverse().join('-')) - new Date(b.date.split('-').reverse().join('-')))
            .map(entry => `- ${entry.date}: ₹${entry.amount.toLocaleString('en-IN')}`)
            .join('\n');

          customDutySummary = `\n\nPRECOMPUTED CUSTOM DUTY EXPENSE SUMMARY:\n- Total Custom Duty entries found: ${uniqueCustomDutyEntries.length}\n- Total Custom Duty expense: ₹${totalCustomDuty.toLocaleString('en-IN')}\n\nDetailed breakdown:\n${customDutyBreakdown}\n\n**IMPORTANT**: Focus exclusively on Custom Duty breakdown.\n`;
          console.log('[CHAT] Precomputed Custom Duty expense:', { entries: uniqueCustomDutyEntries.length, total: totalCustomDuty });
        } else {
          customDutySummary = `\n\nPRECOMPUTED CUSTOM DUTY EXPENSE SUMMARY:\n- No Custom Duty expenses found for the specified period.\n`;
          console.log('[CHAT] No Custom Duty expenses found for the specified period');
        }
      } else {
        // Handle Major Expenses/Payments queries using dynamic keyword matching
        const majorExpenseEntries = [];
        for (const ch of dateFilteredChunks) {
          const text = ch.content || (ch._doc && ch._doc.content) || '';
          const found = await extractMajorExpensesFromText(text, wantedMonths, wantedYears, userId)
            .then(results => results.map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' })));
          if (found.length) {
            console.log('[CHAT] Found', found.length, 'major expense entries in chunk from', ch.fileName);
            majorExpenseEntries.push(...found);
          }
        }

        // Remove duplicates and prepare for Python calculation
        const uniqueMajorExpenses = [];
        const seenMajorExpense = new Set();
        for (const entry of majorExpenseEntries) {
          const key = `${entry.date}|${entry.account}|${entry.amount}`;
          if (!seenMajorExpense.has(key)) {
            seenMajorExpense.add(key);
            uniqueMajorExpenses.push(entry);
          }
        }

        if (uniqueMajorExpenses.length > 0) {
          console.log('[CHAT] Using Python for accurate major expense calculation from', uniqueMajorExpenses.length, 'entries...');
          
          try {
            // Use Python calculation for precise totals
            const { calculateExpenseTotals } = require('../utils/pythonCalculator');
            const pythonResult = await calculateExpenseTotals(uniqueMajorExpenses, dateContext);
            const totalMajorExpenses = pythonResult.total_amount;
            
            // Group by expense category for better analysis
            const expensesByCategory = uniqueMajorExpenses.reduce((acc, entry) => {
              const category = entry.account;
              if (!acc[category]) {
                acc[category] = { entries: [], total: 0 };
              }
              acc[category].entries.push(entry);
              acc[category].total += entry.amount;
              return acc;
            }, {});

            // Create detailed breakdown
            const categoryBreakdown = Object.entries(expensesByCategory)
              .sort(([,a], [,b]) => b.total - a.total)
              .slice(0, 10) // Top 10 categories
              .map(([category, data]) => `- ${category}: ₹${data.total.toLocaleString('en-IN')} (${data.entries.length} entries)`)
              .join('\n');

            // Create detailed entry list with dates
            const detailedEntries = uniqueMajorExpenses
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .map(entry => {
                const formattedDate = new Date(entry.date).toLocaleDateString('en-GB', { 
                  day: '2-digit', 
                  month: 'short', 
                  year: '2-digit' 
                });
                return `${formattedDate}: ${entry.account} - ₹${entry.amount.toLocaleString('en-IN')}`;
              })
              .join('\n');

            majorExpenseSummary = `\n\nPRECOMPUTED MAJOR EXPENSE SUMMARY (Python-calculated):\n- Total major expense entries found: ${uniqueMajorExpenses.length}\n- Total major expenses: ₹${totalMajorExpenses.toLocaleString('en-IN')}\n\nTop expense categories:\n${categoryBreakdown}\n\nDETAILED EXPENSE ENTRIES (Date: Account - Amount):\n${detailedEntries}\n\n**IMPORTANT**: These are major business expenses identified by keyword matching. Analysis focuses on significant cost drivers.\n`;
            
            console.log('[CHAT] Precomputed major expenses (Python):', { entries: uniqueMajorExpenses.length, total: totalMajorExpenses });
          } catch (error) {
            console.error('[CHAT] Python calculation failed, using fallback:', error);
            
            // Enhanced fallback calculation with detailed breakdown
            const totalMajorExpenses = uniqueMajorExpenses.reduce((sum, entry) => sum + entry.amount, 0);
            
            // Group by expense category for better analysis
            const expensesByCategory = uniqueMajorExpenses.reduce((acc, entry) => {
              const category = entry.account;
              if (!acc[category]) {
                acc[category] = { entries: [], total: 0 };
              }
              acc[category].entries.push(entry);
              acc[category].total += entry.amount;
              return acc;
            }, {});

            // Create detailed breakdown
            const categoryBreakdown = Object.entries(expensesByCategory)
              .sort(([,a], [,b]) => b.total - a.total)
              .slice(0, 10) // Top 10 categories
              .map(([category, data]) => `- ${category}: ₹${data.total.toLocaleString('en-IN')} (${data.entries.length} entries)`)
              .join('\n');

            // Create detailed entry list with dates
            const detailedEntries = uniqueMajorExpenses
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .map(entry => {
                const formattedDate = new Date(entry.date).toLocaleDateString('en-GB', { 
                  day: '2-digit', 
                  month: 'short', 
                  year: '2-digit' 
                });
                return `${formattedDate}: ${entry.account} - ₹${entry.amount.toLocaleString('en-IN')}`;
              })
              .join('\n');

            // Monthly breakdown if date filtering is applied
            let monthlyBreakdown = '';
            if (dateContext.isDateSpecific && dateContext.months.length > 0) {
              const monthlyData = uniqueMajorExpenses.reduce((acc, entry) => {
                const entryDate = new Date(entry.date);
                const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
                if (!acc[monthKey]) {
                  acc[monthKey] = { total: 0, count: 0 };
                }
                acc[monthKey].total += entry.amount;
                acc[monthKey].count += 1;
                return acc;
              }, {});

              const monthlyList = Object.entries(monthlyData)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, data]) => `- ${month}: ₹${data.total.toLocaleString('en-IN')} (${data.count} entries)`)
                .join('\n');

              if (monthlyList) {
                monthlyBreakdown = `\n\nMonthly breakdown:\n${monthlyList}`;
              }
            }

            majorExpenseSummary = `\n\nPRECOMPUTED MAJOR EXPENSE SUMMARY (Enhanced Fallback):\n- Total major expense entries found: ${uniqueMajorExpenses.length}\n- Total major expenses: ₹${totalMajorExpenses.toLocaleString('en-IN')}\n\nTop expense categories:\n${categoryBreakdown}\n\nDETAILED EXPENSE ENTRIES (Date: Account - Amount):\n${detailedEntries}${monthlyBreakdown}\n\n**IMPORTANT**: These are major business expenses identified by keyword matching. Analysis focuses on significant cost drivers.\n`;
          }
        } else {
          majorExpenseSummary = `\n\nPRECOMPUTED MAJOR EXPENSE SUMMARY:\n- No major expenses found for the specified period using keyword matching.\n`;
          console.log('[CHAT] No major expenses found for the specified period');
        }
      }
    }

    // Enhanced payment handling: Major Payments detection
    let majorPaymentSummary = '';
    
    if (queryType === 'payment' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      // Handle Major Payments queries using dynamic keyword matching
      const majorPaymentEntries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = await extractMajorExpensesFromText(text, wantedMonths, wantedYears, userId)
          .then(results => results.map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' })));
        if (found.length) {
          console.log('[CHAT] Found', found.length, 'major payment entries in chunk from', ch.fileName);
          majorPaymentEntries.push(...found);
        }
      }

      // Remove duplicates and prepare for Python calculation
      const uniqueMajorPayments = [];
      const seenMajorPayment = new Set();
      for (const entry of majorPaymentEntries) {
        const key = `${entry.date}|${entry.account}|${entry.amount}`;
        if (!seenMajorPayment.has(key)) {
          seenMajorPayment.add(key);
          uniqueMajorPayments.push(entry);
        }
      }

      if (uniqueMajorPayments.length > 0) {
        console.log('[CHAT] Using Python for accurate major payment calculation from', uniqueMajorPayments.length, 'entries...');
        
        try {
          // Use Python calculation for precise totals
          const { calculateExpenseTotals } = require('../utils/pythonCalculator');
          const pythonResult = await calculateExpenseTotals(uniqueMajorPayments, dateContext);
          const totalMajorPayments = pythonResult.total_amount;

          // Group by payment category for better analysis
          const paymentsByCategory = pythonResult.categories || {};
          const categoryBreakdown = Object.entries(paymentsByCategory)
            .sort(([,a], [,b]) => b.total - a.total)
            .slice(0, 10) // Top 10 categories
            .map(([category, data]) => `- ${category}: ₹${data.total.toLocaleString('en-IN')} (${data.count} entries)`)
            .join('\n');

          // Create detailed entry list with dates
          const detailedEntries = uniqueMajorPayments
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(entry => {
              const formattedDate = new Date(entry.date).toLocaleDateString('en-GB', { 
                day: '2-digit', 
                month: 'short', 
                year: '2-digit' 
              });
              return `${formattedDate}: ${entry.account} - ₹${entry.amount.toLocaleString('en-IN')}`;
            })
            .join('\n');

          majorPaymentSummary = `\n\nPRECOMPUTED MAJOR PAYMENT SUMMARY (Python-calculated):\n- Total major payment entries found: ${uniqueMajorPayments.length}\n- Total major payments: ₹${totalMajorPayments.toLocaleString('en-IN')}\n\nTop payment categories:\n${categoryBreakdown}\n\nDETAILED PAYMENT ENTRIES (Date: Account - Amount):\n${detailedEntries}\n\n**IMPORTANT**: These are major business payments identified by keyword matching. Analysis focuses on significant payment outflows.\n`;
          
          console.log('[CHAT] Precomputed major payments (Python):', { entries: uniqueMajorPayments.length, total: totalMajorPayments });
        } catch (error) {
          console.error('[CHAT] Python calculation failed, using fallback:', error);
          
          // Enhanced fallback calculation with detailed breakdown
          const totalMajorPayments = uniqueMajorPayments.reduce((sum, entry) => sum + entry.amount, 0);
          
          // Group by payment category for better analysis
          const paymentsByCategory = uniqueMajorPayments.reduce((acc, entry) => {
            const category = entry.account;
            if (!acc[category]) {
              acc[category] = { entries: [], total: 0 };
            }
            acc[category].entries.push(entry);
            acc[category].total += entry.amount;
            return acc;
          }, {});

          // Create detailed breakdown
          const categoryBreakdown = Object.entries(paymentsByCategory)
            .sort(([,a], [,b]) => b.total - a.total)
            .slice(0, 10) // Top 10 categories
            .map(([category, data]) => `- ${category}: ₹${data.total.toLocaleString('en-IN')} (${data.entries.length} entries)`)
            .join('\n');

          // Create detailed entry list with dates
          const detailedEntries = uniqueMajorPayments
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(entry => {
              const formattedDate = new Date(entry.date).toLocaleDateString('en-GB', { 
                day: '2-digit', 
                month: 'short', 
                year: '2-digit' 
              });
              return `${formattedDate}: ${entry.account} - ₹${entry.amount.toLocaleString('en-IN')}`;
            })
            .join('\n');

          majorPaymentSummary = `\n\nPRECOMPUTED MAJOR PAYMENT SUMMARY (Fallback calculation):\n- Total major payment entries found: ${uniqueMajorPayments.length}\n- Total major payments: ₹${totalMajorPayments.toLocaleString('en-IN')}\n\nTop payment categories:\n${categoryBreakdown}\n\nDETAILED PAYMENT ENTRIES (Date: Account - Amount):\n${detailedEntries}\n\n**IMPORTANT**: These are major business payments identified by keyword matching. Analysis focuses on significant payment outflows.\n`;
          
          console.log('[CHAT] Precomputed major payments (Fallback):', { entries: uniqueMajorPayments.length, total: totalMajorPayments });
        }
      } else {
        majorPaymentSummary = `\n\nPRECOMPUTED MAJOR PAYMENT SUMMARY:\n- No major payments found for the specified period using keyword matching.\n`;
        console.log('[CHAT] No major payments found for the specified period');
      }
    }

    // Additional sales processing (only if not already processed above)
    if (queryType === 'sales' && dateContext && dateContext.isDateSpecific && !salesSummary) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      let entries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = extractSalesFromText(text, wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) {
          console.log('[CHAT] Found', found.length, 'sales entries in chunk from', ch.fileName);
          console.log('[CHAT] Sample entries:', found.slice(0, 3).map(e => `${e.date}: ${e.account} = ${e.amount}`));
          entries.push(...found);
        }
      }
      
      // Debug: Check for duplicates and negative amounts
      console.log('[CHAT] Total entries before filtering:', entries.length);
      const positiveEntries = entries.filter(e => e.amount > 0);
      const negativeEntries = entries.filter(e => e.amount < 0);
      const zeroEntries = entries.filter(e => e.amount === 0);
      console.log('[CHAT] Positive amounts:', positiveEntries.length, 'Negative amounts:', negativeEntries.length, 'Zero amounts:', zeroEntries.length);
      
      if (negativeEntries.length > 0) {
        console.log('[CHAT] Sample negative entries:', negativeEntries.slice(0, 3).map(e => `${e.date}: ${e.account} = ${e.amount}`));
      }
      
      // Remove duplicates based on date + account + amount
      const uniquePositiveEntries = [];
      const seen = new Set();
      for (const entry of positiveEntries) {
        const key = `${entry.date}|${entry.account}|${entry.amount}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniquePositiveEntries.push(entry);
        }
      }
      
      console.log('[CHAT] After deduplication: ', uniquePositiveEntries.length, 'unique positive entries');
      
      // Debug: List all 22 entries to see what's missing in AI response
      console.log('[CHAT] All sales entries found:');
      uniquePositiveEntries.forEach((entry, index) => {
        console.log(`  ${index + 1}. ${entry.date}: ${entry.account} = ${entry.amount}`);
      });
      
      entries = uniquePositiveEntries;

      // Group entries by year based on the date string (e.g., 'DD-Mon-YY')
      const entriesByYear = entries.reduce((acc, entry) => {
          const yearSuffix = entry.date.slice(-2);
          const year = `20${yearSuffix}`;
          if (!acc[year]) {
              acc[year] = [];
          }
          acc[year].push(entry);
          return acc;
      }, {});

      // Build a clear summary based on the date context
      const isMonthSpecific = dateContext.months && dateContext.months.length > 0;
      const isYearSpecific = dateContext.years && dateContext.years.length > 0;
      
      if (isMonthSpecific && isYearSpecific) {
        // Month-specific query like "april 2023 sales"
        const monthName = dateContext.months[0];
        const year = dateContext.years[0];
        salesSummary = `\n\nPRECOMPUTED SALES SUMMARY FOR ${monthName.toUpperCase()} ${year}:\n`;
      } else {
        salesSummary = '\n\nPRECOMPUTED SALES SUMMARY (BREAKDOWN BY PERIOD):\n';
      }
      
      const { calculateSalesTotals } = require('../utils/pythonCalculator');

      // Calculate total for each year and build the summary string
      for (const year of Object.keys(entriesByYear).sort()) { // Sort years to ensure order
          const yearEntries = entriesByYear[year];
          let yearTotal = 0;
          let pythonCalculationNote = '';

          try {
              console.log(`[CHAT] Using Python for accurate sales total calculation for ${year} from ${yearEntries.length} entries...`);
              const pythonResult = await calculateSalesTotals(yearEntries, null); // Pass null for dateContext as it's not needed for summing a pre-filtered list
              yearTotal = pythonResult.total_amount;
              pythonCalculationNote = ' (Python-calculated)';
              console.log(`[CHAT] Python calculation for ${year} successful:`, { total: yearTotal });
          } catch (error) {
              console.error(`[CHAT] Python calculation for ${year} failed, using fallback:`, error);
              yearTotal = yearEntries.reduce((s, e) => s + (e.amount || 0), 0);
              pythonCalculationNote = ' (Fallback calculation)';
          }

          if (isMonthSpecific && isYearSpecific) {
            // For month-specific queries, show detailed transaction list
            salesSummary += `\nSALES TRANSACTIONS FOUND:\n`;
            salesSummary += `- Total Transactions: ${yearEntries.length}\n`;
            salesSummary += `- Total Sales Amount: ₹${yearTotal.toLocaleString('en-IN')}${pythonCalculationNote}\n\n`;
            salesSummary += `DETAILED TRANSACTION LIST:\n`;
            yearEntries.forEach((entry, index) => {
              salesSummary += `${index + 1}. ${entry.date} | ${entry.account} | ₹${entry.amount.toLocaleString('en-IN')}\n`;
            });
          } else {
            salesSummary += `\n--- DATA FOR FINANCIAL YEAR ${year} ---\n`;
            salesSummary += `- Entries found: ${yearEntries.length}\n`;
            salesSummary += `- Total sales amount: ₹${yearTotal.toLocaleString('en-IN')}${pythonCalculationNote}\n`;
          }
      }

      salesSummary += '\n**IMPORTANT**: Use ONLY this precomputed data. The transactions listed above are the complete and accurate sales data for the requested period. Present these exact numbers and transaction details.\n';
      console.log('[CHAT] Precomputed sales (date-filtered scan with breakdown) generated.');
    }

    // Deterministic precomputation: journals (Jrnl) for date-specific queries
    let journalSummary = '';
    if (queryType === 'journal' && dateContext && dateContext.isDateSpecific) {
      const monthAbbrevs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const wantedMonths = new Set(
        (dateContext.months || [])
          .map(m => String(m).toLowerCase().slice(0,3))
          .filter(m => monthAbbrevs.includes(m))
      );
      const wantedYears = new Set((dateContext.years || []).map(y => String(y).slice(-2)));

      const entries = [];
      for (const ch of dateFilteredChunks) {
        const text = ch.content || (ch._doc && ch._doc.content) || '';
        const found = extractEntriesOfTypeFromText(text, 'Jrnl', wantedMonths, wantedYears)
          .map(e => ({ ...e, fileName: ch.fileName || 'Unknown file' }));
        if (found.length) entries.push(...found);
      }
      const totalDebit = entries.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0);
      const totalCredit = entries.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
      const sample = entries.slice(0, 25)
        .map(e => `- ${e.date} | ${e.account} | Amt: ${e.amount.toLocaleString()} | File: ${e.fileName}`)
        .join('\n');
      journalSummary = `\n\nPRECOMPUTED JOURNAL (JRNL) SUMMARY (Deterministic):\n- Entries found: ${entries.length}\n- Total debits: ${totalDebit.toLocaleString()}\n- Total credits: ${totalCredit.toLocaleString()}\nSample entries:\n${sample}\n`;
      console.log('[CHAT] Precomputed journals (date-filtered scan):', { count: entries.length, totalDebit, totalCredit });
    }

    // Estimate token usage to prevent overflow
    const contextLength = context.length;
    const validationLength = validationContext.length;
    const questionLength = question.length;
    const totalEstimatedTokens = Math.ceil((contextLength + validationLength + questionLength) / 4); // Rough estimation
    
    console.log('[CHAT] Token estimation - Context:', contextLength, 'chars, Validation:', validationLength, 'chars, Question:', questionLength, 'chars');
    console.log('[CHAT] Estimated total tokens:', totalEstimatedTokens);
    
    // Smart context clearing for precomputed queries
    if (queryType === 'expense' && (customDutySummary || majorExpenseSummary)) {
      finalContext = ''; // Clear chunk context to force model focus on precomputed data
      finalValidationContext = '';
      console.log('[CHAT] Expense query with precomputed summary. Clearing chunk context to force model focus.');
    } else if (queryType === 'payment' && majorPaymentSummary) {
      finalContext = ''; // Clear chunk context to force model focus on precomputed data
      finalValidationContext = '';
      console.log('[CHAT] Payment query with precomputed summary. Clearing chunk context to force model focus.');
    }
    
    // Clear context for sales queries to force AI to use precomputed data only
    if (queryType === 'sales' && salesSummary) {
      finalContext = ''; // Clear chunk context to force model focus on precomputed data
      finalValidationContext = '';
      console.log('[CHAT] Sales query with precomputed summary. Clearing chunk context to force model focus.');
    } else {
      finalContext = context;
      finalValidationContext = validationContext;
    }

    // Enhance prompt with query-type-specific instructions
    let extraInstructions = '';
    if (queryType === 'loan') {
      extraInstructions = '\nIMPORTANT: Only include transactions where the account or narration contains the word "Loan", "OD", "Bank Loan", "Secured Loan", or "Unsecured Loan". Ignore regular payments, receipts, and expenses. Deduplicate loans by account and counterparty. Do not double-count the same loan.';
    } else if (queryType === 'sales') {
      extraInstructions = '\nCRITICAL: If you see a "COMPLETE SALES VOUCHER LIST" section, USE ONLY that data. List ALL vouchers exactly as provided. DO NOT create fake examples like "ABC Corp", "XYZ Ltd". Use ONLY the real company names and amounts from the actual Tally data. Each voucher line is real data from the file.';
    } else if (queryType === 'purchase') {
      extraInstructions = '\nIMPORTANT: Include ALL purchase-related entries (purchase, supplier, GRN, material, inventory, stock, goods received). Do not overlook any purchase transactions. Check for variations like "purc", "supplier", "material", "inventory", "stock", "goods received", "GRN".';
    } else if (queryType === 'journal') {
      extraInstructions = '\nIMPORTANT: Include ONLY journal (Jrnl) vouchers. Report both debit (negative) and credit (positive) amounts. If a specific date is requested (e.g., 1-May-24), list all Jrnl entries on that date. Do not include purchases, sales, receipts.';
    } else if (queryType === 'expense') {
      if (customDutySummary) {
        extraInstructions = '\nCRITICAL: Use the PRECOMPUTED CUSTOM DUTY SUMMARY provided. This contains all Custom Duty expenses already calculated. Present the totals and breakdown from this summary. Do not perform additional calculations.';
      } else if (majorExpenseSummary) {
        extraInstructions = '\nCRITICAL: Use the PRECOMPUTED MAJOR EXPENSE SUMMARY provided. This contains all major expenses already calculated with precise totals. Present the breakdown and totals from this summary. Do not perform additional calculations.';
      } else {
        extraInstructions = '\nIMPORTANT: Only include entries with "Expense" or related terms in the account or narration. Ignore purchases, sales, and receipts.';
      }
    } else if (queryType === 'receipt') {
      extraInstructions = '\nIMPORTANT: Only include entries with "Receipt" or "Rcpt" in the account or narration. Ignore unrelated transactions.';
    } else if (queryType === 'payment') {
      if (majorPaymentSummary) {
        extraInstructions = '\nCRITICAL: Use the PRECOMPUTED MAJOR PAYMENT SUMMARY provided. This contains all major payments already calculated with precise totals. Present the breakdown and totals from this summary. Do not perform additional calculations.';
      } else {
        extraInstructions = '\nCRITICAL: Use the COMPLETE PAYMENT ENTRIES LIST provided in the context. This contains ALL payment entries found. Present the complete list organized by date, showing every single entry.';
      }
    } else if (queryType === 'profit') {
      extraInstructions = '\nCRITICAL: Use the ACCOUNTING PROFIT CALCULATION provided in the context. This contains the correct profit calculation using proper accounting principles. Present the results from this calculation, NOT a simple credits minus debits approach.';
    } else if (queryType === 'ledger') {
      const isSalesQuery = question.toLowerCase().includes('sale');
      const isPurchaseQuery = question.toLowerCase().includes('purchase') || question.toLowerCase().includes('purc');
      const salesNote = isSalesQuery ? ' The results have been pre-filtered to show ONLY sales transactions (voucher type: Sale).' : '';
      const purchaseNote = isPurchaseQuery ? ' The results have been pre-filtered to show ONLY purchase transactions (voucher type: Purc).' : '';
      extraInstructions = `\nCRITICAL: Use ONLY the "COMPLETE CHRONOLOGICAL TRANSACTION LISTING" from the PRECOMPUTED LEDGER SEARCH RESULTS. IGNORE ALL RAW TRANSACTION DATA. The transactions in the precomputed results are already sorted in PERFECT CHRONOLOGICAL ORDER and pre-filtered for your query.${salesNote}${purchaseNote} DO NOT reorder, resort, or reorganize the transactions - they are already in the correct chronological sequence. Present ALL transactions exactly as listed in the "COMPLETE CHRONOLOGICAL TRANSACTION LISTING" section. DO NOT reference any raw CSV data or other transaction sources. The precomputed chronological list is the FINAL and COMPLETE answer.`;
    }

    // Add bank-specific instructions if bank is detected
    if (bankName) {
      extraInstructions += `\nCRITICAL BANK FILTER: You are ONLY allowed to analyze data related to ${bankName.toUpperCase()} bank. Ignore ALL data from other banks. When counting vouchers, verify each entry specifically mentions ${bankName.toUpperCase()} or its variations. Do not include entries from other banks like Bajaj, HDFC, SBI, etc.`;
    }

    // Add date-specific instructions if date context is detected
    if (dateContext.isDateSpecific) {
      const dateFilter = dateContext.months.length > 0 || dateContext.years.length > 0;
      if (dateFilter) {
        extraInstructions += `\nCRITICAL DATE FILTER: You are ONLY allowed to analyze data from ${dateContext.months.join(', ')} ${dateContext.years.join(', ')}. Ignore ALL data from other periods. When counting vouchers, verify each date matches the requested period.`;
      }
    }

    // Build enhanced prompt with precomputed data
    // For ledger queries, minimize raw data context to force AI to use precomputed results
    const contextToUse = queryType === 'ledger' ? '' : finalContext;
    const validationToUse = queryType === 'ledger' ? '' : finalValidationContext;
    
    const enhancedPrompt = createEnhancedPrompt(
      question,
      contextToUse,
      validationToUse,
      salesSummary,
      customDutySummary || majorExpenseSummary || majorPaymentSummary,
      journalSummary,
      cashBalanceSummary + ledgerSummary,
      queryType,
      dateContext
    );

    const multiFilePrompt = `You are analyzing data from ${totalFiles} uploaded file(s): ${userTallyData.map(d => d.originalFileName).join(', ')}.\n\n${enhancedPrompt}`;
    
    console.log('[CHAT] Enhanced prompt created with multi-file context for', totalFiles, 'files.');
    console.log('[CHAT] Date context:', dateContext);
    console.log('[CHAT] Bank context:', bankName);
    console.log('[CHAT] Calling OpenAI API...');
    console.log('[CHAT] OpenAI model:', OPENAI_MODEL);

    // Prepare chat history as proper OpenAI messages (limit to last 8 turns to control tokens)
    const historyMessages = Array.isArray(chatHistory)
      ? chatHistory.slice(-8).map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: String(msg.content || '')
        }))
      : [];

    // Compose messages array
    const systemMessage = { 
      role: 'system', 
      content: `You are a helpful and knowledgeable Tally data analysis assistant with a conversational, ChatGPT-like style. Follow these CRITICAL rules:

1. **RESPONSE STYLE**: Be conversational, friendly, and helpful like ChatGPT. Use natural language, provide context, and explain your findings clearly. If the user says things like "explain it" or "why", elaborate on the previous answer with a step-by-step breakdown and plain-language summary.

2. **ACCURACY & PRECISION**: 
   - When a specific date/month/year is mentioned, ONLY analyze data from that exact period
   - Each "Voucher:" line represents one voucher - count them exactly once
   - Never include data from wrong periods or make assumptions
   - Always verify dates match the requested period before counting

3. **BANK-SPECIFIC QUERIES**: 
   - If user asks about a specific bank (e.g., "ICICI bank loan"), ONLY include data from that bank
   - Do NOT include data from other banks (e.g., if asking about ICICI, don't include Bajaj)
   - Use exact bank name matching

4. **PURCHASE ENTRIES**: 
   - Include ALL purchase-related entries (purchase, supplier, GRN, material, inventory, stock, goods received)
   - Do not overlook any purchase transactions
   - Check for variations and related terms

5. **RESPONSE STRUCTURE**:
   - Start with a clear summary of what you found
   - Provide detailed breakdown with specific numbers and dates
   - Use bullet points or numbered lists for clarity
   - Include relevant file names and data sources
   - End with any important insights or recommendations

6. **FOLLOW-UP QUESTIONS**: 
   - Consider the chat history context for follow-up questions
   - Maintain conversation continuity
   - Reference previous answers when relevant

7. **CLARITY**: State exactly which date range you analyzed and what you found
8. **CONTEXT**: Consider all provided chunks when answering, not just the first few
9. **VALIDATION**: Use the provided data summary to verify your analysis

For date-specific queries like "sales vouchers in July 2025", ONLY count vouchers with dates in July 2025.` 
    };

    const messages = [
      systemMessage,
      ...historyMessages,
      { role: 'user', content: multiFilePrompt }
    ];

    // Call OpenAI API using axios with enhanced system prompt and real history
    // Use higher token limit for date-specific queries to ensure complete responses
    // Extra high limit for ledger queries with many transactions
    let maxTokens = 1500;
    if (dateContext && dateContext.isDateSpecific) {
      maxTokens = queryType === 'ledger' ? 4000 : 3000;
    }
    console.log('[CHAT] Using max_tokens:', maxTokens, 'for date-specific query:', dateContext?.isDateSpecific);
    
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3
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
    // Improved error visibility for Axios/OpenAI errors
    if (err && err.response) {
      console.error('[CHAT][OpenAI ERROR]', {
        status: err.response.status,
        statusText: err.response.statusText,
        headers: err.response.headers,
        data: err.response.data
      });
    } else if (err && err.request) {
      console.error('[CHAT][OpenAI REQUEST ERROR] No response received', {
        message: err.message
      });
    } else {
      console.error('[CHAT][ERROR]', err);
    }
    res.status(500).json({ error: 'Chat failed' });
  }
};