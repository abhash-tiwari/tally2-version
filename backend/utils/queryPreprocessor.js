// Query preprocessing utility to improve AI understanding
// Handles date normalization, month name expansion, ledger search, and other query improvements

const LedgerData = require('../models/LedgerData');

/**
 * Helper function to get all months between two given months and years
 * @param {string} startMon - Start month (e.g., 'jul')
 * @param {string} endMon - End month (e.g., 'sep')
 * @param {string} startYY - Start year (e.g., '22')
 * @param {string} endYY - End year (e.g., '22')
 * @returns {Array} - Array of {month, year} objects for all months in range
 */
function getMonthsInRange(startMon, endMon, startYY, endYY) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const result = [];
  
  const startMonthIdx = months.indexOf(startMon.toLowerCase());
  const endMonthIdx = months.indexOf(endMon.toLowerCase());
  const startYear = parseInt(startYY);
  const endYear = parseInt(endYY);
  
  if (startMonthIdx === -1 || endMonthIdx === -1) {
    return result;
  }
  
  if (startYear === endYear) {
    // Same year - iterate from start month to end month
    for (let i = startMonthIdx; i <= endMonthIdx; i++) {
      result.push({ month: months[i], year: startYY });
    }
  } else {
    // Multi-year range
    // From start month to end of start year
    for (let i = startMonthIdx; i < 12; i++) {
      result.push({ month: months[i], year: startYY });
    }
    
    // Full years in between
    for (let year = startYear + 1; year < endYear; year++) {
      for (let i = 0; i < 12; i++) {
        result.push({ month: months[i], year: year.toString().slice(-2) });
      }
    }
    
    // From start of end year to end month
    for (let i = 0; i <= endMonthIdx; i++) {
      result.push({ month: months[i], year: endYY });
    }
  }
  
  return result;
}

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
  const dateKeywords = ['date', 'month', 'year', 'period', 'during', 'in', 'on', 'between', 'quarter'];
  dateKeywords.forEach(keyword => {
    if (lowerQuery.includes(keyword)) {
      context.hasDateQuery = true;
    }
  });

  // NEW: detect quarter-based queries
  const quarterPatterns = [
    // Q1, Q2, Q3, Q4 format
    /\b(q[1-4])\s+(\d{4})\b/gi,
    /\b(\d{4})\s+(q[1-4])\b/gi,
    // Allow words between quarter token and year (e.g., "q1 sales 2023", "2023 sales q1")
    /\b(q[1-4])\b[^\d]{0,50}?\b(\d{4})\b/gi,
    /\b(\d{4})\b[^q]{0,50}?\b(q[1-4])\b/gi,
    // First/Second/Third/Fourth quarter format (with typo support)
    /\b(first|second|third|fourth)\s+(quarter|quater)\s+(\d{4})\b/gi,
    /\b(\d{4})\s+(first|second|third|fourth)\s+(quarter|quater)\b/gi,
    // Quarter 1/2/3/4 format (with typo support)
    /\b(quarter|quater)\s+([1-4])\s+(\d{4})\b/gi,
    /\b(\d{4})\s+(quarter|quater)\s+([1-4])\b/gi,
    // Additional patterns for "quarter 1 of 2024" format
    /\b(quarter|quater)\s+([1-4])\s+(?:of\s+)?(\d{4})\b/gi,
    /\b(quarter|quater)\s+([1-4])\s+.*?(\d{4})\b/gi
  ];

  for (const qp of quarterPatterns) {
    const matches = [...query.matchAll(qp)];
    if (matches.length > 0) {
      context.hasDateQuery = true;
      context.isDateSpecific = true;
      let specificDateRanges = [];

      for (const m of matches) {
        let quarterNum, year;

        // Extract quarter number and year from different formats
        if (m[1] && m[2]) {
          if (/^q[1-4]$/i.test(m[1])) {
            quarterNum = parseInt(m[1].slice(1));
            year = m[2];
          } else if (/^(first|second|third|fourth)$/i.test(m[1])) {
            const quarterMap = { 'first': 1, 'second': 2, 'third': 3, 'fourth': 4 };
            quarterNum = quarterMap[m[1].toLowerCase()];
            year = m[3];
          } else if (/^\d{4}$/.test(m[1])) {
            year = m[1];
            if (/^q[1-4]$/i.test(m[2])) {
              quarterNum = parseInt(m[2].slice(1));
            } else if (/^(first|second|third|fourth)$/i.test(m[2])) {
              const quarterMap = { 'first': 1, 'second': 2, 'third': 3, 'fourth': 4 };
              quarterNum = quarterMap[m[2].toLowerCase()];
            } else if (/^[1-4]$/.test(m[3])) {
              quarterNum = parseInt(m[3]);
            }
          } else if (/^(quarter|quater)$/i.test(m[1])) {
            quarterNum = parseInt(m[2]);
            year = m[3] || m[4]; // Handle both m[3] and m[4] for new patterns
          }
        }

        if (quarterNum && year) {
          const quarterMonths = {
            1: ['jan', 'feb', 'mar'],
            2: ['apr', 'may', 'jun'],
            3: ['jul', 'aug', 'sep'],
            4: ['oct', 'nov', 'dec']
          };
          const months = quarterMonths[quarterNum];
          if (months) {
            specificDateRanges.push(`Q${quarterNum} ${year}`);
            context.months.push(...months.map(m => capitalize3(m)));
            context.years.push(year);
            context.dateTerms.push(`Q${quarterNum}`, year);
          }
        }
      }

      if (specificDateRanges.length > 0) {
        context.specificDateRange = specificDateRanges.join(' and ');
        // Remove duplicate months and years
        context.months = [...new Set(context.months)];
        context.years = [...new Set(context.years)];
      }
    }
  }

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

  // NEW: detect financial year patterns first
  const fyPatterns = [
    // FY2022-23, FY 2022-23, fy2022-23
    /\bfy\s*(\d{4})-?(\d{2})\b/i,
    // Financial year 2022-23, financial year 2022-2023
    /\bfinancial\s+year\s+(\d{4})-?(\d{2,4})\b/i,
    // Date range patterns for FY: 01-04-22 to 31-03-23
    /\b(\d{1,2})-(\d{1,2})-(\d{2,4})\s+to\s+(\d{1,2})-(\d{1,2})-(\d{2,4})\b/i
  ];

  for (const fyp of fyPatterns) {
    const m = query.match(fyp);
    if (m) {
      let startYear, endYear;
      
      if (m[1] && m[2] && !m[3]) {
        // FY2022-23 format
        startYear = m[1];
        endYear = m[2].length === 2 ? '20' + m[2] : m[2];
        
        // Financial year runs from April to March
        context.hasDateQuery = true;
        context.isDateSpecific = true;
        context.specificDateRange = `FY ${startYear}-${m[2]}`;
        
        // Generate all 12 months of the financial year
        const fyMonths = getMonthsInRange('apr', 'mar', startYear.slice(-2), endYear.slice(-2));
        context.months = [...new Set(fyMonths.map(m => capitalize3(m.month)))];
        context.years = [...new Set(fyMonths.map(m => m.year.length === 2 ? '20' + m.year : m.year))];
        context.dateTerms.push('FY', startYear, endYear);
        break;
      } else if (m[1] && m[2] && m[3] && m[4] && m[5] && m[6]) {
        // Date range format: 01-04-22 to 31-03-23
        const startDay = m[1], startMonth = m[2], startYearRaw = m[3];
        const endDay = m[4], endMonth = m[5], endYearRaw = m[6];
        
        // Convert to proper format
        const startYY = normalizeToYY(startYearRaw);
        const endYY = normalizeToYY(endYearRaw);
        const startMonAbbr = normalizeToMonthAbbrev(startMonth);
        const endMonAbbr = normalizeToMonthAbbrev(endMonth);
        
        if (startMonAbbr && endMonAbbr && startYY && endYY) {
          context.hasDateQuery = true;
          context.isDateSpecific = true;
          context.specificDateRange = `${startDay}-${startMonth}-${startYearRaw} to ${endDay}-${endMonth}-${endYearRaw}`;
          
          // Generate all months in the range
          const rangeMonths = getMonthsInRange(startMonAbbr.toLowerCase(), endMonAbbr.toLowerCase(), startYY, endYY);
          context.months = [...new Set(rangeMonths.map(m => capitalize3(m.month)))];
          context.years = [...new Set(rangeMonths.map(m => m.year.length === 2 ? '20' + m.year : m.year))];
          context.dateTerms.push(startDay, startMonth, startYearRaw, endDay, endMonth, endYearRaw);
          break;
        }
      }
    }
  }

  // If no FY pattern matched, try other range patterns
  if (!context.isDateSpecific) {
    const rangePatterns = [
      // DD-MM-YY format ranges
      /\bfrom\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\s+to\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\b/i,
      /\bbetween\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\s+and\s+(\d{1,2}[-\/](\d{1,2}|[A-Za-z]{3,})[-\/]\d{2,4})\b/i,
      // Month name format ranges: "from july 2024 to sept 2024"
      /\bfrom\s+([A-Za-z]{3,})\s+(\d{4})\s+to\s+([A-Za-z]{3,})\s+(\d{4})\b/i,
      /\bbetween\s+([A-Za-z]{3,})\s+(\d{4})\s+and\s+([A-Za-z]{3,})\s+(\d{4})\b/i
    ];
    for (const rp of rangePatterns) {
      const m = query.match(rp);
      if (m) {
        let start, end, startStr, endStr;
        
        // Check if this is a month name format range (groups 1,2,3,4)
        if (m[1] && m[2] && m[3] && m[4] && /^[A-Za-z]{3,}$/.test(m[1])) {
          // Month name format: "from july 2024 to sept 2024"
          const startMonth = m[1];
          const startYear = m[2];
          const endMonth = m[3];
          const endYear = m[4];
          
          const startMonAbbr = normalizeToMonthAbbrev(startMonth);
          const endMonAbbr = normalizeToMonthAbbrev(endMonth);
          const startYY = normalizeToYY(startYear);
          const endYY = normalizeToYY(endYear);
          
          if (startMonAbbr && endMonAbbr && startYY && endYY) {
            start = { mon: startMonAbbr.toLowerCase(), yy: startYY };
            end = { mon: endMonAbbr.toLowerCase(), yy: endYY };
            startStr = `${startMonth} ${startYear}`;
            endStr = `${endMonth} ${endYear}`;
          }
        } else {
          // DD-MM-YY format: "from 01-07-2024 to 30-09-2024"
          startStr = m[1];
          endStr = m[3];
          start = parseDateddMonYY(startStr);
          end = parseDateddMonYY(endStr);
        }
        
        if (start && end) {
          context.hasDateQuery = true;
          context.isDateSpecific = true;
          context.specificDateRange = `${startStr} to ${endStr}`;
          context.rangeStart = start;
          context.rangeEnd = end;
          // Populate ALL months in the range, not just start and end
          const allMonthsInRange = getMonthsInRange(start.mon, end.mon, start.yy, end.yy);
          const monthsSet = new Set(allMonthsInRange.map(m => m.month));
          const yearsSet = new Set(allMonthsInRange.map(m => m.year));
          context.months.push(...Array.from(monthsSet).map(x => capitalize3(x)));
          context.years.push(...Array.from(yearsSet).map(y => (y.length === 2 ? '20' + y : y)));
          break;
        }
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
 * @param {string} validationContext - Validation context
 * @param {string} salesSummary - Precomputed sales summary
 * @param {string} expenseSummary - Precomputed expense summary (major expenses or custom duty)
 * @param {string} journalSummary - Precomputed journal summary
 * @param {string} cashBalanceSummary - Precomputed cash balance summary
 * @param {string} queryType - Type of query (sales, expense, etc.)
 * @param {object} dateContext - Date context information
 * @returns {string} - Enhanced prompt for AI
 */
function createEnhancedPrompt(originalQuery, context, validationContext, salesSummary, expenseSummary, journalSummary, cashBalanceSummary, receiptSummary, queryType, dateContext) {
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
    if (expenseSummary && expenseSummary.includes('PRECOMPUTED')) {
      prompt += `
CRITICAL EXPENSE ANALYSIS INSTRUCTIONS:
1. **USE ONLY THE PRECOMPUTED EXPENSE SUMMARY PROVIDED** - Do not analyze raw data chunks
2. The precomputed summary contains accurate calculations from Python microservice
3. Present the total amount and category breakdown exactly as provided in the summary
4. List the top expense categories with their amounts and entry counts
5. Include monthly breakdown if provided in the summary
6. Format amounts in Indian Rupees with proper comma notation (₹XX,XX,XXX)
7. **DO NOT** perform additional calculations or search for payment vouchers
8. **DO NOT** fabricate company names or amounts not in the precomputed data
9. Focus on the keyword-matched major expenses, not general payment vouchers
10. Explain that these are major business expenses identified through keyword matching
`;
    } else {
      prompt += `
MAJOR EXPENSE IDENTIFICATION REQUIREMENTS:
1. Find ALL lines with "Pymt" (Payment vouchers) in the data
2. Extract the amount from each payment line
3. Convert amounts to positive and sort by size (largest first)
4. Show the TOP 5-10 largest payment amounts regardless of account name
5. Format: "Company Name - ₹Amount (Date)"
6. Ignore small amounts under ₹1 lakh when there are crore-level payments
7. CRITICAL: Focus on the AMOUNT field after "Pymt", not the account name
8. Only use data explicitly present - do not fabricate company names
`;
    }
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

  // Add precomputed summaries to the prompt
  let precomputedData = '';
  if (salesSummary) {
    precomputedData += salesSummary;
  }
  if (expenseSummary) {
    precomputedData += expenseSummary;
  }
  if (journalSummary) {
    precomputedData += journalSummary;
  }
  if (cashBalanceSummary) {
    precomputedData += cashBalanceSummary;
  }
  if (receiptSummary) {
    precomputedData += receiptSummary;
  }

  prompt += `
PRECOMPUTED SUMMARIES (USE THESE FIRST):
${precomputedData}

AVAILABLE DATA (from multiple files/chunks):
${context}

VALIDATION CONTEXT:
${validationContext || ''}

QUESTION: ${originalQuery}

STEP-BY-STEP INSTRUCTIONS:
1. Analyze the question and identify the key requirements
2. **CRITICAL FOR EXPENSE QUERIES**: If this is an expense query and you see a "PRECOMPUTED MAJOR EXPENSE SUMMARY" or "PRECOMPUTED CUSTOM DUTY SUMMARY", USE ONLY that precomputed data. DO NOT analyze raw payment vouchers or fabricate company names. **IMPORTANT**: If the precomputed summary includes "DETAILED EXPENSE ENTRIES", you MUST list each individual transaction with its date, account name, and amount in chronological order. Do not just show category summaries.
3. **CRITICAL FOR SALES QUERIES**: If this is a sales query and you see a "PRECOMPUTED SALES SUMMARY" section, USE ONLY that filtered data. DO NOT analyze raw data chunks that may contain negative amounts (returns/credit notes).
4. **CRITICAL FOR QUARTER COMPARISON QUERIES**: If comparing quarters (e.g., Q1 2023 vs Q1 2024):
   - The precomputed sales summary contains entries from BOTH years combined
   - You MUST manually separate entries by year based on the date (e.g., entries with "23" are 2023, entries with "24" are 2024)
   - Calculate SEPARATE totals for each quarter by adding up amounts for each year
   - List entries chronologically within each year
   - Do NOT assign all entries to one year - they span multiple years
   - NEVER show negative amounts for sales - all sales amounts in the summary are positive
4. Search the data for relevant entries:
   - For expenses: Use ONLY the precomputed expense summary data (do not analyze raw payment vouchers)
   - For sales: Use ONLY the precomputed sales summary data (positive amounts only)
   - For loans: Look for bank names, financial institutions, loan accounts
   - For vouchers: Look for lines starting with "Voucher:"
   - For financials: Check both Debit (Dr) and Credit (Cr) columns
5. If the query is about totals or counts:
   - Show the calculation method
   - List the items being counted/summed
   - Display the final total clearly
   - VERIFY your count by re-counting
   - **FOR EXPENSE QUERIES**: Always show individual entries with dates when available in the precomputed summary
6. For loan queries:
   - List each loan separately with its details
   - Include the institution, amount, and any relevant dates
   - Calculate and show the total loan amount
7. **SALES DATA FILTERING**: Never include negative sales amounts in your analysis. Negative amounts are returns/credit notes, not actual sales.
8. If data is insufficient, be specific about what's missing
9. If no data is found, say "No data available"
10. BE CONSISTENT: Use the same analysis method for similar queries
11. VERIFY: Double-check your analysis before providing the final answer

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

/**
 * Search for ledger-specific queries and extract ledger keywords
 * @param {string} query - User query
 * @param {string} userId - User ID for ledger lookup
 * @returns {Object} - Ledger search context
 */
async function extractLedgerContext(query, userId) {
  try {
    const context = {
      isLedgerQuery: false,
      matchedLedgers: [],
      searchKeywords: []
    };

    // Get user's ledger data
    const ledgerData = await LedgerData.find({ userId });
    if (ledgerData.length === 0) {
      return context;
    }

    // Extract potential ledger names from query
    const queryWords = query.toLowerCase().split(/[\s\-_,\.]+/).filter(word => word.length > 2);
    
    const allLedgers = [];
    ledgerData.forEach(data => {
      data.ledgers.forEach(ledger => {
        allLedgers.push({
          ...ledger.toObject(),
          fileName: data.fileName,
          uploadDate: data.uploadDate
        });
      });
    });

    // Score and match ledgers
    const matchedLedgers = [];
    
    allLedgers.forEach(ledger => {
      let score = 0;
      const matchedKeywords = [];
      
      // Check for exact ledger name match first (highest priority)
      const ledgerNameLower = ledger.name.toLowerCase();
      const queryLower = query.toLowerCase();
      
      // Exact full name match gets massive bonus
      if (queryLower.includes(ledgerNameLower) || ledgerNameLower.includes(queryLower.replace(/[^a-z\s]/g, '').trim())) {
        score += 100;
        matchedKeywords.push('exact_name_match');
        console.log(`[LEDGER_MATCH] Exact name match found: "${ledger.name}" in query: "${query}"`);
      }
      
      queryWords.forEach(queryWord => {
        // Partial name match (high score)
        if (ledgerNameLower.includes(queryWord)) {
          score += 15;
          matchedKeywords.push(queryWord);
        }
        
        // Keyword match (lower score)
        ledger.keywords.forEach(ledgerKeyword => {
          if (ledgerKeyword.includes(queryWord)) {
            score += 3;
            matchedKeywords.push(queryWord);
          }
          if (ledgerKeyword === queryWord) {
            score += 5;
          }
        });
      });
      
      if (score > 0) {
        matchedLedgers.push({
          ...ledger,
          matchScore: score,
          matchedKeywords: [...new Set(matchedKeywords)]
        });
      }
    });

    // Sort by match score
    matchedLedgers.sort((a, b) => b.matchScore - a.matchScore);
    
    // If we have good matches, this is likely a ledger query
    if (matchedLedgers.length > 0 && matchedLedgers[0].matchScore >= 8) {
      context.isLedgerQuery = true;
      context.matchedLedgers = matchedLedgers.slice(0, 5); // Top 5 matches
      context.searchKeywords = [...new Set(matchedLedgers.flatMap(l => l.keywords))];
      
      console.log('[LEDGER_CONTEXT] Found', matchedLedgers.length, 'ledger matches, top score:', matchedLedgers[0].matchScore);
      console.log('[LEDGER_CONTEXT] Top match:', matchedLedgers[0].name, 'Score:', matchedLedgers[0].matchScore);
    }

    return context;
    
  } catch (error) {
    console.error('[LEDGER_CONTEXT] Error:', error);
    return {
      isLedgerQuery: false,
      matchedLedgers: [],
      searchKeywords: []
    };
  }
}

module.exports = {
  preprocessQuery,
  extractDateContext,
  extractLedgerContext,
  createEnhancedPrompt,
  monthMappings,
  voucherTypeMappings
};
