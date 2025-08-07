/**
 * Data validation utilities for ensuring consistent Tally data analysis
 */

/**
 * Extract all vouchers from a data chunk (handles both CSV and standard formats)
 * @param {string} content - Chunk content
 * @returns {Array} - Array of voucher objects
 */
function extractVouchers(content) {
  // Handle CSV format first
  const csvLines = content.split('\n').filter(line => line.trim() && line.includes(','));
  
  if (csvLines.length > 0) {
    return extractVouchersFromCSV(csvLines);
  }
  
  // Handle standard format
  const voucherLines = content.split('\n').filter(line => line.trim().startsWith('Voucher:'));
  
  return voucherLines.map(line => {
    // Parse voucher line: "Voucher: 4-Jul-25 | Type: Sale | Account: Sales Account | Dr: 0 | Cr: 50000 | Narration: Sales to ABC Ltd"
    const parts = line.split('|').map(part => part.trim());
    
    const voucher = {};
    parts.forEach(part => {
      if (part.startsWith('Voucher:')) {
        voucher.date = part.replace('Voucher:', '').trim();
      } else if (part.startsWith('Type:')) {
        voucher.type = part.replace('Type:', '').trim();
      } else if (part.startsWith('Account:')) {
        voucher.account = part.replace('Account:', '').trim();
      } else if (part.startsWith('Dr:')) {
        voucher.debit = part.replace('Dr:', '').trim();
      } else if (part.startsWith('Cr:')) {
        voucher.credit = part.replace('Cr:', '').trim();
      } else if (part.startsWith('Narration:')) {
        voucher.narration = part.replace('Narration:', '').trim();
      }
    });
    
    return voucher;
  });
}

/**
 * Extract vouchers from CSV format data
 * @param {Array} csvLines - Array of CSV lines
 * @returns {Array} - Array of voucher objects
 */
function extractVouchersFromCSV(csvLines) {
  const vouchers = [];
  
  // Group lines by date to form complete vouchers
  const vouchersByDate = {};
  
  csvLines.forEach(line => {
    const parts = line.split(',').map(part => part.replace(/"/g, '').trim());
    if (parts.length >= 4) {
      const date = parts[0];
      const account = parts[1];
      const narration = parts[2];
      const voucherType = parts[3];
      const debit = parts[4] || '0';
      const credit = parts[5] || '0';
      
      if (!vouchersByDate[date]) {
        vouchersByDate[date] = [];
      }
      
      vouchersByDate[date].push({
        date,
        account,
        narration,
        type: voucherType,
        debit: parseFloat(debit) || 0,
        credit: parseFloat(credit) || 0
      });
    }
  });
  
  // Convert grouped data to voucher format
  Object.keys(vouchersByDate).forEach(date => {
    const entries = vouchersByDate[date];
    if (entries.length > 0) {
      // Find the main entry (usually the first one with a significant amount)
      const mainEntry = entries.find(entry => 
        Math.abs(entry.debit) > 0 || Math.abs(entry.credit) > 0
      ) || entries[0];
      
      vouchers.push({
        date: mainEntry.date,
        type: mainEntry.type,
        account: mainEntry.account,
        debit: mainEntry.debit.toString(),
        credit: mainEntry.credit.toString(),
        narration: mainEntry.narration
      });
    }
  });
  
  return vouchers;
}

/**
 * Count vouchers by type and date range
 * @param {Array} chunks - Array of data chunks
 * @param {string} voucherType - Type to filter by (optional)
 * @param {object} dateRange - Date range to filter by (optional)
 * @returns {object} - Count and voucher details
 */
function countVouchersByTypeAndDate(chunks, voucherType = null, dateRange = null) {
  const allVouchers = [];
  
  chunks.forEach(chunk => {
    const vouchers = extractVouchers(chunk.content || '');
    allVouchers.push(...vouchers);
  });
  
  // Filter by type if specified
  let filteredVouchers = allVouchers;
  if (voucherType) {
    const typeLower = voucherType.toLowerCase();
    filteredVouchers = allVouchers.filter(v => 
      v.type && v.type.toLowerCase().includes(typeLower)
    );
  }
  
  // Filter by date range if specified
  if (dateRange) {
    filteredVouchers = filteredVouchers.filter(v => {
      if (!v.date) return false;
      
      // Parse date and check if it's in the specified range
      const dateMatch = v.date.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
      if (!dateMatch) return false;
      
      const [, day, month, year] = dateMatch;
      const voucherDate = new Date(parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year), 
                                 getMonthNumber(month), parseInt(day));
      
      if (dateRange.start && voucherDate < dateRange.start) return false;
      if (dateRange.end && voucherDate > dateRange.end) return false;
      
      return true;
    });
  }
  
  return {
    count: filteredVouchers.length,
    vouchers: filteredVouchers,
    totalDebit: filteredVouchers.reduce((sum, v) => sum + (parseFloat(v.debit) || 0), 0),
    totalCredit: filteredVouchers.reduce((sum, v) => sum + (parseFloat(v.credit) || 0), 0)
  };
}

/**
 * Get month number from month abbreviation
 * @param {string} monthAbbr - Month abbreviation (e.g., "Jul")
 * @returns {number} - Month number (0-11)
 */
function getMonthNumber(monthAbbr) {
  const monthMap = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };
  return monthMap[monthAbbr.toLowerCase()] || 0;
}

/**
 * Validate date format in Tally data
 * @param {string} dateStr - Date string to validate
 * @returns {boolean} - True if valid Tally date format
 */
function isValidTallyDate(dateStr) {
  return /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(dateStr);
}

/**
 * Create a summary of data for consistency checking
 * @param {Array} chunks - Array of data chunks
 * @returns {object} - Data summary for validation
 */
function createDataSummary(chunks) {
  const summary = {
    totalChunks: chunks.length,
    totalVouchers: 0,
    voucherTypes: {},
    dateRange: { min: null, max: null },
    accounts: new Set(),
    totalDebit: 0,
    totalCredit: 0
  };
  
  chunks.forEach(chunk => {
    const vouchers = extractVouchers(chunk.content || '');
    summary.totalVouchers += vouchers.length;
    
    vouchers.forEach(voucher => {
      // Count voucher types
      if (voucher.type) {
        summary.voucherTypes[voucher.type] = (summary.voucherTypes[voucher.type] || 0) + 1;
      }
      
      // Track accounts
      if (voucher.account) {
        summary.accounts.add(voucher.account);
      }
      
      // Track amounts
      summary.totalDebit += parseFloat(voucher.debit) || 0;
      summary.totalCredit += parseFloat(voucher.credit) || 0;
      
      // Track date range
      if (voucher.date && isValidTallyDate(voucher.date)) {
        const dateMatch = voucher.date.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const voucherDate = new Date(parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year), 
                                     getMonthNumber(month), parseInt(day));
          
          if (!summary.dateRange.min || voucherDate < summary.dateRange.min) {
            summary.dateRange.min = voucherDate;
          }
          if (!summary.dateRange.max || voucherDate > summary.dateRange.max) {
            summary.dateRange.max = voucherDate;
          }
        }
      }
    });
  });
  
  summary.accounts = Array.from(summary.accounts);
  
  return summary;
}

module.exports = {
  extractVouchers,
  extractVouchersFromCSV,
  countVouchersByTypeAndDate,
  isValidTallyDate,
  createDataSummary,
  getMonthNumber
};
