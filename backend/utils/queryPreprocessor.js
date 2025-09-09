// Query preprocessing utility to improve AI understanding
// Handles date normalization, month name expansion, and other query improvements

const monthMappings = {
  'january': 'Jan',
  'february': 'Feb', 
  'march': 'Mar',
  'april': 'Apr',
  'may': 'May',
  'june': 'Jun',
  'july': 'Jul',
  'august': 'Aug',
  'september': 'Sep',
  'october': 'Oct',
  'november': 'Nov',
  'december': 'Dec'
};

const voucherTypeMappings = {
  'sales': 'Sale',
  'sale': 'Sale',
  'purchase': 'Purc',
  'purchases': 'Purc',
  'receipt': 'Rcpt',
  'receipts': 'Rcpt',
  'payment': 'Pymt',
  'payments': 'Pymt',
  'credit note': 'C/Note',
  'credit notes': 'C/Note',
  'debit note': 'D/Note',
  'debit notes': 'D/Note'
};

/**
 * Preprocesses user queries to improve AI understanding
 * @param {string} query - The user's original query
 * @returns {string} - Enhanced query with normalized terms
 */
function preprocessQuery(query) {
  let processedQuery = query.toLowerCase();
  
  // Normalize month names
  Object.keys(monthMappings).forEach(fullMonth => {
    const regex = new RegExp(`\\b${fullMonth}\\b`, 'gi');
    processedQuery = processedQuery.replace(regex, monthMappings[fullMonth]);
  });
  
  // Normalize voucher types
  Object.keys(voucherTypeMappings).forEach(fullType => {
    const regex = new RegExp(`\\b${fullType}\\b`, 'gi');
    processedQuery = processedQuery.replace(regex, voucherTypeMappings[fullType]);
  });
  
  // Add both original and processed terms for better matching
  const enhancedQuery = `${query} ${processedQuery}`;
  
  console.log('[QUERY_PREPROCESSOR] Original:', query);
  console.log('[QUERY_PREPROCESSOR] Enhanced:', enhancedQuery);
  
  return enhancedQuery;
}

/**
 * Extracts date-related context from query for better prompt engineering
 * @param {string} query - The user's query
 * @returns {object} - Date context information
 */
function extractDateContext(query) {
  const context = {
    hasDateQuery: false,
    months: [],
    years: [],
    dateTerms: [],
    specificDateRange: null,
    isDateSpecific: false,
    rangeStart: null,
    rangeEnd: null
  };
  
  const lowerQuery = query.toLowerCase();
  
  // Check for month names (full and abbreviated)
  const allMonths = [...Object.keys(monthMappings), ...Object.values(monthMappings)];
  allMonths.forEach(month => {
    if (lowerQuery.includes(month.toLowerCase())) {
      context.hasDateQuery = true;
      context.months.push(month);
      context.dateTerms.push(month);
      context.isDateSpecific = true;
    }
  });
  
  // Check for years (allow 2-digit as before for generic coverage)
  const yearMatches = lowerQuery.match(/\b(20\d{2}|19\d{2}|\d{2})\b/g);
  if (yearMatches) {
    context.hasDateQuery = true;
    context.years = yearMatches;
    context.dateTerms.push(...yearMatches);
    context.isDateSpecific = true;
  }
  
  // Check for specific date patterns
  const datePatterns = [
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\b/gi,
    /\b\d{4}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi
  ];
  
  datePatterns.forEach(pattern => {
    const match = lowerQuery.match(pattern);
    if (match) {
      context.hasDateQuery = true;
      context.isDateSpecific = true;
      context.specificDateRange = match[0];
    }
  });
  
  // Check for date-related keywords
  const dateKeywords = ['date', 'month', 'year', 'period', 'during', 'in', 'on', 'between'];
  dateKeywords.forEach(keyword => {
    if (lowerQuery.includes(keyword)) {
      context.hasDateQuery = true;
    }
  });

  // NEW: detect explicit DD-MMM-YY or DD-MM-YY single date
  const singleDateRegex = /\b(\d{1,2})[-\/](\d{1,2}|[A-Za-z]{3,})[-\/](\d{2,4})\b/;
  const singleMatch = lowerQuery.match(singleDateRegex);
  if (singleMatch) {
    context.hasDateQuery = true;
    context.isDateSpecific = true;
    // Normalize month token
    const d = singleMatch[1];
    const mRaw = singleMatch[2];
    const yRaw = singleMatch[3];
    const monAbbr = normalizeToMonthAbbrev(mRaw);
    if (monAbbr) context.months.push(monAbbr);
    const yy = normalizeToYY(yRaw);
    if (yy) context.years.push(yy.length === 2 ? '20' + yy : yy);
    context.dateTerms.push(singleMatch[0]);
  }

  // NEW: detect explicit ranges: "from A to B" or "between A and B"
  const rangePatterns = [
    /\bfrom\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\s+to\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\b/i,
    /\bbetween\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\s+and\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\b/i
  ];
  for (const rp of rangePatterns) {
    const m = query.match(rp);
    if (m) {
      const startStr = m[1];
      const endStr = m[3];
      const start = parseDateddMonYY(startStr);
      const end = parseDateddMonYY(endStr);
      if (start && end) {
        context.hasDateQuery = true;
        context.isDateSpecific = true;
        context.specificDateRange = `${startStr} to ${endStr}`;
        context.rangeStart = start;
        context.rangeEnd = end;
        // Populate months/years for downstream filters without overriding existing tokens
        const monthsSet = new Set([start.mon, end.mon]);
        const yearsSet = new Set([start.yy, end.yy]);
        context.months.push(...Array.from(monthsSet).map(x => capitalize3(x)));
        context.years.push(...Array.from(yearsSet).map(y => (y.length === 2 ? '20' + y : y)));
        break;
      }
    }
  }

  return context;
}

// Helpers
function normalizeToMonthAbbrev(m) {
  const s = String(m).toLowerCase();
  if (/^\d{1,2}$/.test(s)) {
    const idx = parseInt(s, 10) - 1;
    const abbr = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][idx];
    return abbr ? capitalize3(abbr) : null;
  }
  if (monthMappings[s]) return monthMappings[s];
  const abbr = s.slice(0,3);
  const valid = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  return valid.includes(abbr) ? capitalize3(abbr) : null;
}

function normalizeToYY(y) {
  const s = String(y);
  if (/^\d{2}$/.test(s)) return s;
  if (/^\d{4}$/.test(s)) return s.slice(-2);
  return null;
}

function parseDateddMonYY(str) {
  // Accept: DD-MMM-YY, DD-MM-YY, with / as separator as well, year 2 or 4 digits
  const m = String(str).match(/^(\d{1,2})[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]((?:\d{2})|(?:\d{4}))$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const monAbbr = normalizeToMonthAbbrev(m[2]);
  const yy = normalizeToYY(m[3]);
  if (!monAbbr || !yy) return null;
  return { d: dd, mon: monAbbr.toLowerCase(), yy };
}

function capitalize3(s) {
  return s.slice(0,1).toUpperCase() + s.slice(1,3);
}

/**
 * Creates an enhanced prompt with better date context
 * @param {string} originalQuery - Original user query
 * @param {string} context - Data context from vector search
 * @param {object} dateContext - Date context information
 * @returns {string} - Enhanced prompt for AI
 */
function createEnhancedPrompt(originalQuery, context, dateContext) {
  const isVoucherQuery = /voucher|transaction|entry|sale|purchase|receipt|payment|credit note|debit note/i.test(originalQuery);
  const isCountQuery = /how many|count of|number of|total (?:vouchers|transactions)/i.test(originalQuery);
  const isLoanQuery = /loan|borrowing|debt|credit facility|financial institution|bank/i.test(originalQuery);
  
  let prompt = `You are an expert Tally accountant analyzing financial data. Follow these rules STRICTLY:

1. ONLY use information explicitly present in the provided data
2. If data is missing or unclear, say "No data found" instead of making assumptions
3. Be precise with numbers and always show your calculations
4. For financial figures, always specify the currency (e.g., INR, USD)
5. If a query can't be answered from the data, say "No data available"
6. BE CONSISTENT: Use the same counting and analysis method for similar queries
7. VERIFY ALL DATA: Double-check your analysis before providing the final answer

DATA FORMATS:
- Dates: "DD-MMM-YY" (e.g., "4-Jul-25" means July 4, 2025)
- Voucher types: Sale, Purc (Purchase), Rcpt (Receipt), Pymt (Payment), C/Note (Credit Note), D/Note (Debit Note)
- Data format: "Voucher: [Date] | Type: [Type] | Account: [Account] | Dr: [Debit] | Cr: [Credit] | Narration: [Details]"
`;

  // Add specific instructions for voucher counting
  if (isVoucherQuery && isCountQuery) {
    prompt += `
VOUCHER COUNTING RULES:
1. Each line starting with "Voucher:" represents one voucher
2. Count each unique voucher occurrence exactly once (deduplicate by date, amount, and narration)
3. Group by type if specified (e.g., "sales vouchers")
4. Filter by date range if specified
5. Show the count and list key details (date, amount, narration) for verification
6. BE CONSISTENT: If you count 5 vouchers for one query, count 5 for similar queries
7. VERIFY: Re-count to ensure accuracy before providing final answer
`;
  }

  // Add specific instructions for sales queries to ensure completeness
  if (/sales?|revenue|income/i.test(originalQuery)) {
    prompt += `
SALES LISTING REQUIREMENTS:
1. When listing sales vouchers, include ALL entries found in the data
2. Do NOT skip any dates - include isolated single-day entries
3. List entries chronologically by date (earliest to latest)
4. For each entry, show: Date, Customer/Account Name, Amount (if requested)
5. If you find entries on dates like 4-Jul, 8-Jul, 21-Jul, 25-Jul, 26-Jul - include ALL of them
6. Do NOT group or summarize - list each individual voucher
7. CRITICAL: Count every single sales entry, even if it's the only one on that date
8. Verify your list matches the total count mentioned in the system
`;
  }

  // Add specific instructions for credit note queries to ensure completeness
  if (/credit.*note|c\/note|cnote/i.test(originalQuery)) {
    prompt += `
CREDIT NOTE LISTING REQUIREMENTS:
1. When listing credit notes, include ALL entries found in the data - do NOT skip any
2. List entries chronologically by date (earliest to latest)
3. For each entry, show: Date, Customer/Account Name, Amount
4. Include ALL credit notes regardless of amount size (small or large amounts)
5. Do NOT skip high-value entries - they are often the most important
6. CRITICAL: Count every single credit note entry found in the system
7. Verify your total matches the system calculation exactly
8. If system shows x entries, your response must list all x entries
9. Double-check that large amounts are included in your calculation
`;
  }

  if (/cash balance|cash position|bank balance|cash flow|balance/i.test(originalQuery)) {
    prompt += `
CASH BALANCE LISTING REQUIREMENTS:
1. When calculating cash balance, include ALL cash and bank account transactions found in the data
2. List transactions chronologically by date
3. Separate receipts (positive amounts) from payments (negative amounts)
4. Calculate net balance: Total Receipts - Total Payments
5. Group by account/bank for detailed breakdown
6. Include transaction types (Receipt, Payment, Journal, etc.)
7. Show running balance if possible
8. Verify your calculations match the precomputed totals in the system summary
9. Include all major cash/bank accounts (ICICI, HDFC, SBI, Kotak, etc.)
10. BE COMPREHENSIVE: Do not omit any cash-related transactions
`;
  }

  if (/major expense|biggest expense|largest expense|top expense|expense|expenditure|outflow|payment/i.test(originalQuery)) {
    prompt += `
MAJOR EXPENSE IDENTIFICATION REQUIREMENTS:
1. CRITICAL: Look at ALL payment vouchers (Pymt type) and find the LARGEST amounts by value
2. IGNORE account names - focus ONLY on payment amounts regardless of whether account has "Expense" in name
3. Major expenses are the BIGGEST payments by amount.
4. Sort ALL payments by amount (highest to lowest) and show TOP 5-10 largest
5. Include: supplier payments, loan payments, vendor payments, tax payments, salary payments
6. Show: Date, Payee/Account Name, Amount, Voucher Type (Pymt/Jrnl)
7. Calculate percentage of each payment relative to total monthly payments
8. EXAMPLE FORMAT: "Mingjie Stone Spain S L - ₹65,29,213 (21% of total payments)"
9. DO NOT focus on small amounts like ₹12,000 rent when there are ₹65+ lakh payments
10. MAJOR means LARGEST by amount - ignore traditional expense categorization
`;
  }

  // Add specific instructions for loan-related queries
  if (isLoanQuery) {
    prompt += `
LOAN-RELATED QUERIES:
1. Look for transactions containing: 'loan', 'borrowing', 'bank', 'financial institution', or specific bank names
2. For loan amounts, check both Debit (Dr) and Credit (Cr) columns
3. Group loans by institution/account
4. Calculate running totals for each loan account
5. If interest is mentioned, look for separate interest entries
6. For loan types, check the account names and narration
7. If data is incomplete, clearly state what information is missing
8. BE CONSISTENT: Use the same loan identification criteria for similar queries
`;
  }

  if (dateContext.hasDateQuery) {
    prompt += `
CRITICAL DATE FILTERING RULES:
1. Date formats in data: "DD-MMM-YY" (e.g., 4-Jul-25)
2. Month abbreviations: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec
3. For date ranges, include ONLY dates between start and end
4. For month queries, include ONLY days of that specific month
5. For year queries, include ONLY dates from that specific year
6. If exact date not found, look for the closest date and indicate this in the response
7. NEVER include data from other months/years unless specifically requested
8. When counting vouchers by date, be extremely strict about date filtering
9. If the query asks for a specific month/year, ONLY count entries from that exact period
10. Double-check all dates before including them in your count or analysis
11. BE CONSISTENT: Use the same date filtering logic for similar queries
`;
  }

  // Add specific date filtering instructions for date-specific queries
  if (dateContext.isDateSpecific) {
    const dateFilter = dateContext.months.length > 0 || dateContext.years.length > 0;
    if (dateFilter) {
      prompt += `
STRICT DATE FILTERING INSTRUCTIONS:
- You are ONLY allowed to analyze data from the specified date range
- If the query mentions "${dateContext.months.join(', ')} ${dateContext.years.join(', ')}", ONLY count/analyze entries from that exact period
- Ignore ALL data from other months/years
- When counting vouchers, verify each date matches the requested period
- If you find data from other periods, exclude it completely
- Be explicit about which date range you're analyzing
- BE CONSISTENT: Use the same date range logic for similar queries
`;
    }
  }

  prompt += `
AVAILABLE DATA (from multiple files/chunks):
${context}

QUESTION: ${originalQuery}

STEP-BY-STEP INSTRUCTIONS:
1. Analyze the question and identify the key requirements
2. Search the data for relevant entries:
   - For loans: Look for bank names, financial institutions, loan accounts
   - For vouchers: Look for lines starting with "Voucher:"
   - For financials: Check both Debit (Dr) and Credit (Cr) columns
3. If the query is about totals or counts:
   - Show the calculation method
   - List the items being counted/summed
   - Display the final total clearly
   - VERIFY your count by re-counting
4. For loan queries:
   - List each loan separately with its details
   - Include the institution, amount, and any relevant dates
   - Calculate and show the total loan amount
5. If data is insufficient, be specific about what's missing
6. If no data is found, say "No data available"
7. BE CONSISTENT: Use the same analysis method for similar queries
8. VERIFY: Double-check your analysis before providing the final answer

FINAL ANSWER:
- Be specific and include all relevant numbers
- Show your work/calculations
- State if any assumptions were made
- If uncertain, say "Insufficient data to provide a complete answer"
- Never make up or guess information
- For date-specific queries, clearly state the date range you analyzed
- BE CONSISTENT: If you provide a count, ensure it's accurate and repeatable
- VERIFY: Re-check your analysis to ensure consistency`;

  return prompt;
}

module.exports = {
  preprocessQuery,
  extractDateContext,
  createEnhancedPrompt,
  monthMappings,
  voucherTypeMappings
};
