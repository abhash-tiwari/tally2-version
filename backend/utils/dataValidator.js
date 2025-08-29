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

  csvLines.forEach(line => {
    // Naive CSV split with quotes stripping; adequate for our Tally export lines
    const parts = line.split(',').map(part => part.replace(/"/g, '').trim());
    if (parts.length < 4) return;

    const date = parts[0] || '';
    const account = parts[1] || '';
    const narration = parts[2] || '';
    const voucherType = parts[3] || '';
    const debitRaw = parts[4] || '';
    const creditRaw = parts[5] || '';

    const toNum = (v) => {
      const n = parseFloat(String(v).replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const voucher = {
      date,
      account,
      narration,
      type: voucherType,
      debit: toNum(debitRaw).toString(),
      credit: toNum(creditRaw).toString()
    };

    vouchers.push(voucher);
  });

  return vouchers;
}

/**
 * Enhanced purchase entry detection with better mapping
 * @param {Array} chunks - Array of data chunks
 * @returns {Array} - Array of purchase-related entries
 */
function extractPurchaseEntries(chunks) {
  const purchaseEntries = [];
  
  chunks.forEach(chunk => {
    const content = chunk.content || '';
    const lines = content.split('\n');
    
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      
      // Enhanced purchase detection patterns
      if (
        lowerLine.includes('purchase') || 
        lowerLine.includes('purc') || 
        lowerLine.includes('purchases') ||
        lowerLine.includes('supplier') ||
        lowerLine.includes('grn') ||
        lowerLine.includes('goods received') ||
        lowerLine.includes('material') ||
        lowerLine.includes('inventory') ||
        lowerLine.includes('stock') ||
        lowerLine.includes('raw material') ||
        lowerLine.includes('finished goods')
      ) {
        // Extract purchase-related information
        const purchaseEntry = {
          content: line.trim(),
          type: 'purchase',
          fileName: chunk.fileName || 'Unknown',
          chunkIndex: chunk.chunkIndex || 0
        };
        
        // Try to extract additional details
        if (line.includes('|')) {
          const parts = line.split('|').map(part => part.trim());
          parts.forEach(part => {
            if (part.includes(':')) {
              const [key, value] = part.split(':').map(s => s.trim());
              purchaseEntry[key.toLowerCase()] = value;
            }
          });
        }
        
        purchaseEntries.push(purchaseEntry);
      }
    });
  });
  
  return purchaseEntries;
}

/**
 * Enhanced bank-specific entry detection
 * @param {Array} chunks - Array of data chunks
 * @param {string} bankName - Specific bank name to search for
 * @returns {Array} - Array of bank-specific entries
 */
function extractBankSpecificEntries(chunks, bankName) {
  if (!bankName) return [];
  
  const bankEntries = [];
  const bankNameLower = bankName.toLowerCase();
  
  // Bank name variations and common abbreviations
  const bankVariations = {
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
  
  // Find exact bank match
  let targetBankVariations = [];
  for (const [bank, variations] of Object.entries(bankVariations)) {
    if (bankNameLower.includes(bank) || variations.some(v => bankNameLower.includes(v))) {
      targetBankVariations = variations;
      break;
    }
  }
  
  if (targetBankVariations.length === 0) {
    // If no exact match, use the provided bank name
    targetBankVariations = [bankNameLower];
  }
  
  chunks.forEach(chunk => {
    const content = chunk.content || '';
    const lines = content.split('\n');
    
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      
      // Check if line contains any of the target bank variations
      const hasBankMatch = targetBankVariations.some(variation => 
        lowerLine.includes(variation)
      );
      
      if (hasBankMatch) {
        const bankEntry = {
          content: line.trim(),
          bankName: bankName,
          fileName: chunk.fileName || 'Unknown',
          chunkIndex: chunk.chunkIndex || 0,
          relevance: 'exact' // Mark as exact match
        };
        
        // Extract additional details
        if (line.includes('|')) {
          const parts = line.split('|').map(part => part.trim());
          parts.forEach(part => {
            if (part.includes(':')) {
              const [key, value] = part.split(':').map(s => s.trim());
              bankEntry[key.toLowerCase()] = value;
            }
          });
        }
        
        bankEntries.push(bankEntry);
      }
    });
  });
  
  return bankEntries;
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
    totalCredit: 0,
    purchaseEntries: 0,
    bankEntries: new Set()
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
    
    // Count purchase entries
    const purchaseEntries = extractPurchaseEntries([chunk]);
    summary.purchaseEntries += purchaseEntries.length;
    
    // Track bank mentions
    const content = chunk.content || '';
    const bankNames = ['icici', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'bajaj', 'pnb', 'canara', 'union', 'bob'];
    bankNames.forEach(bank => {
      if (content.toLowerCase().includes(bank)) {
        summary.bankEntries.add(bank);
      }
    });
  });
  
  summary.accounts = Array.from(summary.accounts);
  summary.bankEntries = Array.from(summary.bankEntries);
  
  return summary;
}

/**
 * Extract interest on secured loan entries from chunks
 * Applies optional date filtering, bank filtering, and JRNL type enforcement
 * @param {Array} chunks
 * @param {object|null} dateContext - from extractDateContext (months, years, isDateSpecific)
 * @param {string|null} bankName - target bank name (e.g., 'axis', 'icici')
 * @param {boolean} requireJournalType - if true, only include type JRNL/Journal
 * @returns {Array} entries
 */
function extractInterestOnSecuredLoans(chunks, dateContext = null, bankName = null, requireJournalType = false) {
  const entries = [];
  if (!Array.isArray(chunks)) return entries;

  const normalize = (v) => {
    const n = parseFloat(String(v || '').replace(/[\,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // Prepare date filters
  const monthSet = new Set();
  const yearSet = new Set();
  if (dateContext && dateContext.isDateSpecific) {
    (dateContext.months || []).forEach(m => m && monthSet.add(String(m).slice(0,3).toLowerCase()));
    (dateContext.years || []).forEach(y => y && yearSet.add(String(y)));
  }

  // Bank variations
  const bankMap = {
    icici: ['icici', 'icici bank', 'icici ltd', 'icici limited'],
    hdfc: ['hdfc', 'hdfc bank', 'hdfc ltd', 'hdfc limited'],
    sbi: ['sbi', 'state bank', 'state bank of india'],
    axis: ['axis', 'axis bank'],
    kotak: ['kotak', 'kotak bank', 'kotak mahindra'],
    indusind: ['indusind', 'indusind bank'],
    bajaj: ['bajaj', 'bajaj finance', 'bajaj finserv'],
    yes: ['yes', 'yes bank'],
    pnb: ['pnb', 'punjab national bank'],
    canara: ['canara', 'canara bank'],
    union: ['union', 'union bank'],
    bob: ['bob', 'bank of baroda', 'baroda bank']
  };
  const targetBank = bankName ? String(bankName).toLowerCase() : null;
  const targetBankVariants = targetBank && bankMap[targetBank] ? bankMap[targetBank] : (targetBank ? [targetBank] : []);

  chunks.forEach(chunk => {
    const content = chunk.content || '';
    const vouchers = extractVouchers(content);

    vouchers.forEach((v, idx) => {
      const typeLower = String(v.type || '').toLowerCase();
      const accountLower = String(v.account || '').toLowerCase();
      const narrationLower = String(v.narration || '').toLowerCase();

      // Interest detection
      const hasInterest = /\binterest\b|\bint\.?\b|interest on/i.test(v.narration || v.account || '');
      // Secured loan context
      const hasLoanContext = /(secured loan|loan|bank loan|od\b|overdraft|cc account)/i.test(v.narration || v.account || '');
      if (!hasInterest || !hasLoanContext) return;

      // Enforce JRNL if required
      if (requireJournalType) {
        const isJournal = typeLower.includes('jrnl') || typeLower.includes('journal');
        if (!isJournal) return;
      }

      // Date-specific filtering
      if (dateContext && dateContext.isDateSpecific) {
        const dateStr = v.date || '';
        const m = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
        if (!m) return;
        const monthAbbr = m[2].toLowerCase();
        const year2 = m[3];
        const yearFull = (parseInt(year2) < 50 ? 2000 + parseInt(year2) : 1900 + parseInt(year2)).toString();
        if (monthSet.size > 0 && !monthSet.has(monthAbbr)) return;
        if (yearSet.size > 0 && !yearSet.has(yearFull)) return;
      }

      // Amount and potential counterparty pairing
      const debit = normalize(v.debit);
      const credit = normalize(v.credit);
      const amount = Math.max(Math.abs(debit), Math.abs(credit));

      // Try to find a paired voucher on the same date with the same absolute amount whose account looks like a loan
      let partnerAccount = '';
      for (let j = 0; j < vouchers.length; j += 1) {
        if (j === idx) continue;
        const u = vouchers[j];
        if ((u.date || '') !== (v.date || '')) continue;
        const uDebit = normalize(u.debit);
        const uCredit = normalize(u.credit);
        const uAmount = Math.max(Math.abs(uDebit), Math.abs(uCredit));
        if (uAmount !== amount) continue;
        const uAccountLower = String(u.account || '').toLowerCase();
        const uNarrLower = String(u.narration || '').toLowerCase();
        const looksLikeLoanAccount = /(loan|secured|bank|od\b|overdraft|cc account)/i.test(u.account || u.narration || '');
        if (looksLikeLoanAccount) {
          partnerAccount = u.account || '';
          break;
        }
      }

      // Bank-specific filter using either account/narration or paired loan account
      if (targetBankVariants.length > 0) {
        const inThis = targetBankVariants.some(b => accountLower.includes(b) || narrationLower.includes(b));
        const partnerLower = partnerAccount.toLowerCase();
        const inPartner = targetBankVariants.some(b => partnerLower.includes(b));
        if (!inThis && !inPartner) return;
      }

      entries.push({
        date: v.date || '',
        type: v.type || '',
        account: v.account || '',
        narration: v.narration || '',
        debit,
        credit,
        amount,
        fileName: chunk.fileName || 'Unknown',
        partnerAccount
      });
    });
  });

  return entries;
}

module.exports = {
  extractVouchers,
  extractVouchersFromCSV,
  extractPurchaseEntries,
  extractBankSpecificEntries,
  countVouchersByTypeAndDate,
  isValidTallyDate,
  createDataSummary,
  getMonthNumber,
  extractInterestOnSecuredLoans
};
