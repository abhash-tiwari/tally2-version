/**
 * Enhanced purchase entry and bank-specific detection utilities
 */

// Comprehensive purchase-related patterns
const PURCHASE_PATTERNS = {
  primary: [
    'purchase', 'purc', 'purchases', 'buy', 'buying', 'procurement'
  ],
  accounts: [
    'purchase account', 'purchase ledger', 'import purchase', 'export purchase',
    'local purchase', 'interstate purchase', 'purchase-igst', 'purchase-cgst', 'purchase-sgst'
  ],
  suppliers: [
    'supplier', 'suppliers', 'vendor', 'vendors', 'creditor', 'creditors'
  ],
  goods: [
    'goods received', 'grn', 'material', 'materials', 'inventory', 'stock',
    'raw material', 'finished goods', 'work in progress', 'consumables',
    'spare parts', 'components', 'packaging', 'stationery'
  ],
  transactions: [
    'purchase voucher', 'purchase invoice', 'purchase order', 'po',
    'bill', 'bills', 'expense voucher', 'payment voucher'
  ]
};

// Bank-specific patterns with exact matching
const BANK_PATTERNS = {
  'icici': {
    exact: ['icici'],
    variations: ['icici bank', 'icici ltd', 'icici limited', 'icici home finance'],
    exclude: ['bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'hdfc': {
    exact: ['hdfc'],
    variations: ['hdfc bank', 'hdfc ltd', 'hdfc limited', 'hdfc home finance'],
    exclude: ['icici', 'bajaj', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'sbi': {
    exact: ['sbi'],
    variations: ['state bank', 'state bank of india', 'sbi home finance'],
    exclude: ['icici', 'bajaj', 'hdfc', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'kotak': {
    exact: ['kotak'],
    variations: ['kotak bank', 'kotak mahindra', 'kotak mahindra bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'indusind': {
    exact: ['indusind'],
    variations: ['indusind bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'axis': {
    exact: ['axis'],
    variations: ['axis bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'yes': {
    exact: ['yes'],
    variations: ['yes bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'pnb', 'canara', 'union', 'bob']
  },
  'bajaj': {
    exact: ['bajaj'],
    variations: ['bajaj finance', 'bajaj finserv', 'bajaj auto finance'],
    exclude: ['icici', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union', 'bob']
  },
  'pnb': {
    exact: ['pnb'],
    variations: ['punjab national bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'canara', 'union', 'bob']
  },
  'canara': {
    exact: ['canara'],
    variations: ['canara bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'union', 'bob']
  },
  'union': {
    exact: ['union'],
    variations: ['union bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'bob']
  },
  'bank of baroda': {
    exact: ['bob'],
    variations: ['bank of baroda', 'baroda bank'],
    exclude: ['icici', 'bajaj', 'hdfc', 'sbi', 'kotak', 'indusind', 'axis', 'yes', 'pnb', 'canara', 'union']
  }
};

/**
 * Enhanced purchase entry detection with comprehensive pattern matching
 * @param {Array} chunks - Array of data chunks
 * @returns {Array} - Array of purchase-related entries with metadata
 */
function extractPurchaseEntries(chunks) {
  const purchaseEntries = [];
  
  chunks.forEach(chunk => {
    const content = chunk.content || '';
    const lines = content.split('\n');
    
    lines.forEach((line, lineIndex) => {
      const lowerLine = line.toLowerCase();
      let matchType = null;
      let matchedPatterns = [];
      
      // Check primary patterns first
      for (const pattern of PURCHASE_PATTERNS.primary) {
        if (lowerLine.includes(pattern)) {
          matchType = 'primary';
          matchedPatterns.push(pattern);
          break;
        }
      }
      
      // Check account patterns
      if (!matchType) {
        for (const pattern of PURCHASE_PATTERNS.accounts) {
          if (lowerLine.includes(pattern)) {
            matchType = 'account';
            matchedPatterns.push(pattern);
            break;
          }
        }
      }
      
      // Check supplier patterns
      if (!matchType) {
        for (const pattern of PURCHASE_PATTERNS.suppliers) {
          if (lowerLine.includes(pattern)) {
            matchType = 'supplier';
            matchedPatterns.push(pattern);
            break;
          }
        }
      }
      
      // Check goods patterns
      if (!matchType) {
        for (const pattern of PURCHASE_PATTERNS.goods) {
          if (lowerLine.includes(pattern)) {
            matchType = 'goods';
            matchedPatterns.push(pattern);
            break;
          }
        }
      }
      
      // Check transaction patterns
      if (!matchType) {
        for (const pattern of PURCHASE_PATTERNS.transactions) {
          if (lowerLine.includes(pattern)) {
            matchType = 'transaction';
            matchedPatterns.push(pattern);
            break;
          }
        }
      }
      
      if (matchType) {
        // Extract purchase-related information
        const purchaseEntry = {
          content: line.trim(),
          type: 'purchase',
          matchType: matchType,
          matchedPatterns: matchedPatterns,
          fileName: chunk.fileName || 'Unknown',
          chunkIndex: chunk.chunkIndex || 0,
          lineIndex: lineIndex,
          relevance: 'high'
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
 * Enhanced bank-specific entry detection with exact matching and exclusions
 * @param {Array} chunks - Array of data chunks
 * @param {string} bankName - Specific bank name to search for
 * @returns {Array} - Array of bank-specific entries with metadata
 */
function extractBankSpecificEntries(chunks, bankName) {
  if (!bankName) return [];
  
  const bankEntries = [];
  const bankNameLower = bankName.toLowerCase();
  
  // Find bank patterns
  let targetBankPatterns = null;
  for (const [bank, patterns] of Object.entries(BANK_PATTERNS)) {
    if (bankNameLower.includes(bank) || patterns.exact.some(exact => bankNameLower.includes(exact))) {
      targetBankPatterns = patterns;
      break;
    }
  }
  
  if (!targetBankPatterns) {
    // If no exact match, create basic patterns
    targetBankPatterns = {
      exact: [bankNameLower],
      variations: [bankNameLower],
      exclude: []
    };
  }
  
  chunks.forEach(chunk => {
    const content = chunk.content || '';
    const lines = content.split('\n');
    
    lines.forEach((line, lineIndex) => {
      const lowerLine = line.toLowerCase();
      
      // Check for exact bank matches
      const hasExactMatch = targetBankPatterns.exact.some(exact => 
        lowerLine.includes(exact)
      );
      
      // Check for variation matches
      const hasVariationMatch = targetBankPatterns.variations.some(variation => 
        lowerLine.includes(variation)
      );
      
      // Check for excluded banks (to avoid false positives)
      const hasExcludedBank = targetBankPatterns.exclude.some(excluded => 
        lowerLine.includes(excluded)
      );
      
      if ((hasExactMatch || hasVariationMatch) && !hasExcludedBank) {
        const bankEntry = {
          content: line.trim(),
          bankName: bankName,
          fileName: chunk.fileName || 'Unknown',
          chunkIndex: chunk.chunkIndex || 0,
          lineIndex: lineIndex,
          relevance: hasExactMatch ? 'exact' : 'variation',
          matchedPattern: hasExactMatch ? 
            targetBankPatterns.exact.find(exact => lowerLine.includes(exact)) :
            targetBankPatterns.variations.find(variation => lowerLine.includes(variation))
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
  
  // Sort by relevance (exact matches first)
  bankEntries.sort((a, b) => {
    if (a.relevance === 'exact' && b.relevance !== 'exact') return -1;
    if (a.relevance !== 'exact' && b.relevance === 'exact') return 1;
    return 0;
  });
  
  return bankEntries;
}

/**
 * Validate purchase entries for completeness
 * @param {Array} purchaseEntries - Array of purchase entries
 * @returns {object} - Validation summary
 */
function validatePurchaseEntries(purchaseEntries) {
  const validation = {
    total: purchaseEntries.length,
    byType: {},
    byFile: {},
    completeness: 0,
    suggestions: []
  };
  
  purchaseEntries.forEach(entry => {
    // Count by match type
    validation.byType[entry.matchType] = (validation.byType[entry.matchType] || 0) + 1;
    
    // Count by file
    validation.byFile[entry.fileName] = (validation.byFile[entry.fileName] || 0) + 1;
  });
  
  // Calculate completeness score
  const expectedTypes = Object.keys(PURCHASE_PATTERNS);
  const foundTypes = Object.keys(validation.byType);
  validation.completeness = (foundTypes.length / expectedTypes.length) * 100;
  
  // Generate suggestions
  if (validation.completeness < 80) {
    validation.suggestions.push('Consider checking for additional purchase patterns like supplier names, material types, or transaction descriptions');
  }
  
  if (validation.byType.primary < validation.total * 0.3) {
    validation.suggestions.push('Few primary purchase entries found - check if purchase keywords are being captured correctly');
  }
  
  return validation;
}

/**
 * Validate bank entries for accuracy
 * @param {Array} bankEntries - Array of bank entries
 * @param {string} targetBank - Target bank name
 * @returns {object} - Validation summary
 */
function validateBankEntries(bankEntries, targetBank) {
  const validation = {
    total: bankEntries.length,
    exactMatches: 0,
    variationMatches: 0,
    accuracy: 0,
    suggestions: []
  };
  
  bankEntries.forEach(entry => {
    if (entry.relevance === 'exact') {
      validation.exactMatches++;
    } else if (entry.relevance === 'variation') {
      validation.variationMatches++;
    }
  });
  
  // Calculate accuracy score
  validation.accuracy = validation.exactMatches > 0 ? 
    (validation.exactMatches / validation.total) * 100 : 0;
  
  // Generate suggestions
  if (validation.accuracy < 90) {
    validation.suggestions.push(`Ensure ${targetBank} entries are being captured with exact bank name matching`);
  }
  
  if (validation.total === 0) {
    validation.suggestions.push(`No entries found for ${targetBank} - check if bank name variations are being captured`);
  }
  
  return validation;
}

module.exports = {
  extractPurchaseEntries,
  extractBankSpecificEntries,
  validatePurchaseEntries,
  validateBankEntries,
  PURCHASE_PATTERNS,
  BANK_PATTERNS
};


