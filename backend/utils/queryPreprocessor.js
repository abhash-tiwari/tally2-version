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
    dateTerms: []
  };
  
  // Check for month names (full and abbreviated)
  const allMonths = [...Object.keys(monthMappings), ...Object.values(monthMappings)];
  allMonths.forEach(month => {
    if (query.toLowerCase().includes(month.toLowerCase())) {
      context.hasDateQuery = true;
      context.months.push(month);
      context.dateTerms.push(month);
    }
  });
  
  // Check for years
  const yearMatches = query.match(/\b(20\d{2}|19\d{2}|\d{2})\b/g);
  if (yearMatches) {
    context.hasDateQuery = true;
    context.years = yearMatches;
    context.dateTerms.push(...yearMatches);
  }
  
  // Check for date-related keywords
  const dateKeywords = ['date', 'month', 'year', 'period', 'during', 'in', 'on', 'between'];
  dateKeywords.forEach(keyword => {
    if (query.toLowerCase().includes(keyword)) {
      context.hasDateQuery = true;
    }
  });
  
  return context;
}

/**
 * Creates an enhanced prompt with better date context
 * @param {string} originalQuery - Original user query
 * @param {string} context - Data context from vector search
 * @param {object} dateContext - Date context information
 * @returns {string} - Enhanced prompt for AI
 */
function createEnhancedPrompt(originalQuery, context, dateContext) {
  let prompt = `You are an expert Tally accountant analyzing financial data. The data uses specific formats:

DATE FORMAT: Dates are in format "DD-MMM-YY" (e.g., "4-Jul-25" means July 4, 2025)
MONTH ABBREVIATIONS: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec
VOUCHER TYPES: Sale, Purc (Purchase), Rcpt (Receipt), Pymt (Payment), C/Note (Credit Note), D/Note (Debit Note)

Data format: "Voucher: [Date] | Type: [Type] | Account: [Account] | Dr: [Debit] | Cr: [Credit] | Narration: [Details]"

`;

  if (dateContext.hasDateQuery) {
    prompt += `IMPORTANT: This query involves dates. When matching:
- "July" = "Jul", "January" = "Jan", etc.
- "2025" can be "25" in the data
- Look for patterns in the date field of vouchers
- Count entries that match the date criteria

`;
  }

  prompt += `Tally Data:
${context}

Question: ${originalQuery}

Instructions:
1. Analyze the data carefully, paying attention to date formats
2. If counting items, be precise and show your work
3. If no matching data is found, clearly state that
4. Provide specific numbers and details when available

Answer:`;

  return prompt;
}

module.exports = {
  preprocessQuery,
  extractDateContext,
  createEnhancedPrompt,
  monthMappings,
  voucherTypeMappings
};
