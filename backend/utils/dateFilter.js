/**
 * Date filtering utilities for Tally data analysis
 * Handles date parsing and filtering for better query accuracy
 */

const monthMappings = {
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
  'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
  'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
};

/**
 * Parse Tally date format (DD-MMM-YY) to Date object
 * @param {string} tallyDate - Date in format "DD-MMM-YY" or CSV format
 * @returns {Date|null} - Parsed date or null if invalid
 */
function parseTallyDate(tallyDate) {
  if (!tallyDate || typeof tallyDate !== 'string') return null;
  
  try {
    // Handle CSV format: "1-May-25" (with quotes)
    let cleanDate = tallyDate.replace(/"/g, '').trim();
    
    // Handle format: "DD-MMM-YY" (e.g., "4-Jul-25")
    const match = cleanDate.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (match) {
      const [, day, month, year] = match;
      const monthNum = monthMappings[month.toLowerCase()];
      if (!monthNum) return null;
      
      // Convert 2-digit year to 4-digit
      const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
      
      return new Date(fullYear, parseInt(monthNum) - 1, parseInt(day));
    }
    
    // Handle other date formats if needed
    return new Date(cleanDate);
  } catch (error) {
    console.log('[DATE_FILTER] Error parsing date:', tallyDate, error);
    return null;
  }
}

/**
 * Check if a date falls within a specific month and year
 * @param {string} tallyDate - Date in Tally format
 * @param {string} targetMonth - Target month (e.g., "Jul", "July")
 * @param {string} targetYear - Target year (e.g., "2025", "25")
 * @returns {boolean} - True if date matches the criteria
 */
function isDateInMonthYear(tallyDate, targetMonth, targetYear) {
  const parsedDate = parseTallyDate(tallyDate);
  if (!parsedDate) return false;
  
  // Normalize target month
  const monthKey = targetMonth.toLowerCase().substring(0, 3);
  const monthNum = monthMappings[monthKey];
  if (!monthNum) return false;
  
  // Normalize target year - handle both 2-digit and 4-digit years
  let fullTargetYear;
  if (targetYear.length === 2) {
    // 2-digit year: apply conversion logic
    fullTargetYear = parseInt(targetYear) < 50 ? 2000 + parseInt(targetYear) : 1900 + parseInt(targetYear);
  } else {
    // 4-digit year: use as is
    fullTargetYear = parseInt(targetYear);
  }
  
  return parsedDate.getMonth() === parseInt(monthNum) - 1 && 
         parsedDate.getFullYear() === fullTargetYear;
}

/**
 * Filter data chunks by date criteria
 * @param {Array} chunks - Array of data chunks
 * @param {object} dateContext - Date context from query preprocessing
 * @returns {Array} - Filtered chunks that match date criteria
 */
function filterChunksByDate(chunks, dateContext) {
  if (!dateContext.isDateSpecific || (!dateContext.months.length && !dateContext.years.length)) {
    return chunks; // Return all chunks if no specific date criteria
  }
  
  return chunks.filter(chunk => {
    const content = chunk.content || '';
    
    // Extract all dates from the chunk content - handle both formats
    const dateMatches = content.match(/\d{1,2}-[A-Za-z]{3}-\d{2}/g) || [];
    
    // Check if any date in the chunk matches the criteria
    return dateMatches.some(dateStr => {
      if (dateContext.months.length && dateContext.years.length) {
        // Both month and year specified
        return dateContext.months.some(month => 
          dateContext.years.some(year => 
            isDateInMonthYear(dateStr, month, year)
          )
        );
      } else if (dateContext.months.length) {
        // Only month specified
        return dateContext.months.some(month => 
          isDateInMonthYear(dateStr, month, '2025') // Default to current year
        );
      } else if (dateContext.years.length) {
        // Only year specified
        const parsedDate = parseTallyDate(dateStr);
        if (!parsedDate) return false;
        
        // Handle both 2-digit and 4-digit years properly
        const yearStr = dateContext.years[0];
        let fullTargetYear;
        if (yearStr.length === 2) {
          // 2-digit year: apply conversion logic
          fullTargetYear = parseInt(yearStr) < 50 ? 2000 + parseInt(yearStr) : 1900 + parseInt(yearStr);
        } else {
          // 4-digit year: use as is
          fullTargetYear = parseInt(yearStr);
        }
        
        return parsedDate.getFullYear() === fullTargetYear;
      }
      
      return false;
    });
  });
}

/**
 * Extract all dates from a data chunk
 * @param {string} content - Chunk content
 * @returns {Array} - Array of parsed dates
 */
function extractDatesFromChunk(content) {
  const dateMatches = content.match(/\d{1,2}-[A-Za-z]{3}-\d{2}/g) || [];
  return dateMatches.map(dateStr => ({
    original: dateStr,
    parsed: parseTallyDate(dateStr)
  })).filter(date => date.parsed !== null);
}

module.exports = {
  parseTallyDate,
  isDateInMonthYear,
  filterChunksByDate,
  extractDatesFromChunk
};
