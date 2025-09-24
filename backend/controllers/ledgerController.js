const LedgerData = require('../models/LedgerData');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

// Configure multer for ledger file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/ledgers/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'ledger-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept text files, PDFs, and Excel files
    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    const allowedExtensions = ['.txt', '.pdf', '.xls', '.xlsx'];
    
    const isValidType = allowedTypes.includes(file.mimetype);
    const isValidExtension = allowedExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (isValidType || isValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only text files, PDFs, and Excel files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * Extract ledger names from text content
 * @param {string} content - Raw text content from ledger file
 * @returns {Array} - Array of extracted ledger objects
 */
function extractLedgersFromText(content) {
  const ledgers = [];
  const lines = content.split('\n');
  
  let currentCategory = '';
  let currentSubcategory = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Detect main categories (Assets, Liabilities, Income, Expenses, etc.)
    if (line.match(/^(Assets|Liabilities|Income|Expenses|Capital|Current Assets|Fixed Assets|Current Liabilities|Long Term Liabilities)/i)) {
      currentCategory = line;
      currentSubcategory = '';
      continue;
    }
    
    // Detect subcategories
    if (line.match(/^(Current Assets|Fixed Assets|Bank Accounts|Bills Receivables|Cash-in-Hand|Deposits|Security Deposit|Income Tax|Advance Tax|TDS)/i)) {
      currentSubcategory = line;
      continue;
    }
    
    // Skip headers and dates
    if (line.match(/^(List of Ledgers|CIN:|E-Mail:|Helios|Mumbai|\d{1,2}-[A-Za-z]{3}-\d{2})/i)) {
      continue;
    }
    
    // Extract actual ledger names
    if (line.length > 2 && !line.match(/^\d+$/) && !line.includes('@')) {
      // Generate keywords from ledger name
      const keywords = generateKeywordsFromLedgerName(line);
      
      ledgers.push({
        name: line,
        category: currentCategory,
        subcategory: currentSubcategory,
        keywords: keywords
      });
    }
  }
  
  return ledgers;
}

/**
 * Generate search keywords from ledger name
 * @param {string} ledgerName - Name of the ledger
 * @returns {Array} - Array of keywords for searching
 */
function generateKeywordsFromLedgerName(ledgerName) {
  const keywords = [];
  
  // Add the full name
  keywords.push(ledgerName.toLowerCase());
  
  // Split by spaces and add individual words
  const words = ledgerName.toLowerCase().split(/[\s\-_,\.]+/).filter(word => word.length > 2);
  keywords.push(...words);
  
  // Add variations without common suffixes
  const cleanName = ledgerName.toLowerCase()
    .replace(/\s*(pvt|ltd|llp|inc|corp|company|enterprises|industries|traders|exports|imports)\s*/gi, '')
    .trim();
  if (cleanName !== ledgerName.toLowerCase()) {
    keywords.push(cleanName);
  }
  
  // Remove duplicates
  return [...new Set(keywords)];
}


/**
 * Extract ledgers from Excel file
 * @param {string} filePath - Path to Excel file
 * @returns {Array} - Array of extracted ledger objects
 */
function extractLedgersFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Use first sheet
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  
  const ledgers = [];
  let currentCategory = '';
  let currentSubcategory = '';
  
  data.forEach((row, index) => {
    if (!row || row.length === 0) return;
    
    const cellValue = String(row[0] || '').trim();
    if (!cellValue) return;
    
    // Detect main categories
    if (cellValue.match(/^(Assets|Liabilities|Income|Expenses|Capital|Current Assets|Fixed Assets|Current Liabilities|Long Term Liabilities)/i)) {
      currentCategory = cellValue;
      currentSubcategory = '';
      return;
    }
    
    // Detect subcategories
    if (cellValue.match(/^(Current Assets|Fixed Assets|Bank Accounts|Bills Receivables|Cash-in-Hand|Deposits|Security Deposit|Income Tax|Advance Tax|TDS)/i)) {
      currentSubcategory = cellValue;
      return;
    }
    
    // Skip headers and dates
    if (cellValue.match(/^(List of Ledgers|CIN:|E-Mail:|Helios|Mumbai|\d{1,2}-[A-Za-z]{3}-\d{2})/i)) {
      return;
    }
    
    // Extract actual ledger names
    if (cellValue.length > 2 && !cellValue.match(/^\d+$/) && !cellValue.includes('@')) {
      const keywords = generateKeywordsFromLedgerName(cellValue);
      
      ledgers.push({
        name: cellValue,
        category: currentCategory,
        subcategory: currentSubcategory,
        keywords: keywords
      });
    }
  });
  
  return ledgers;
}

/**
 * Upload and process ledger file
 */
const uploadLedgerFile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let extractedLedgers = [];
    
    // Process file based on type
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (fileExtension === '.xlsx' || fileExtension === '.xls') {
      // Process Excel file
      extractedLedgers = extractLedgersFromExcel(file.path);
    } else {
      // Process text file
      const content = fs.readFileSync(file.path, 'utf8');
      extractedLedgers = extractLedgersFromText(content);
    }
    
    console.log('[LEDGER] Extracted', extractedLedgers.length, 'ledgers from', file.originalname);
    
    // Save to database
    const ledgerData = new LedgerData({
      userId: userId,
      fileName: file.originalname,
      ledgers: extractedLedgers
    });
    
    await ledgerData.save();
    
    // Clean up uploaded file
    fs.unlinkSync(file.path);
    
    res.json({
      message: 'Ledger file processed successfully',
      ledgersExtracted: extractedLedgers.length,
      categories: [...new Set(extractedLedgers.map(l => l.category).filter(Boolean))],
      sampleLedgers: extractedLedgers.slice(0, 10)
    });
    
  } catch (error) {
    console.error('[LEDGER] Upload error:', error);
    res.status(500).json({ error: 'Failed to process ledger file' });
  }
};

/**
 * Get all ledgers for a user
 */
const getUserLedgers = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const ledgerData = await LedgerData.find({ userId }).sort({ uploadDate: -1 });
    
    // Flatten all ledgers from all uploads
    const allLedgers = ledgerData.reduce((acc, data) => {
      return acc.concat(data.ledgers.map(ledger => ({
        ...ledger.toObject(),
        fileName: data.fileName,
        uploadDate: data.uploadDate
      })));
    }, []);
    
    res.json({
      totalLedgers: allLedgers.length,
      categories: [...new Set(allLedgers.map(l => l.category).filter(Boolean))],
      ledgers: allLedgers
    });
    
  } catch (error) {
    console.error('[LEDGER] Get ledgers error:', error);
    res.status(500).json({ error: 'Failed to retrieve ledgers' });
  }
};

/**
 * Search ledgers by keyword
 */
const searchLedgers = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }
    
    const searchKeywords = query.toLowerCase().split(/[\s\-_,\.]+/).filter(word => word.length > 1);
    
    const ledgerData = await LedgerData.find({ userId });
    
    const matchingLedgers = [];
    
    ledgerData.forEach(data => {
      data.ledgers.forEach(ledger => {
        const score = calculateMatchScore(searchKeywords, ledger);
        if (score > 0) {
          matchingLedgers.push({
            ...ledger.toObject(),
            fileName: data.fileName,
            uploadDate: data.uploadDate,
            matchScore: score
          });
        }
      });
    });
    
    // Sort by match score (highest first)
    matchingLedgers.sort((a, b) => b.matchScore - a.matchScore);
    
    res.json({
      query: query,
      matches: matchingLedgers.slice(0, 20) // Return top 20 matches
    });
    
  } catch (error) {
    console.error('[LEDGER] Search error:', error);
    res.status(500).json({ error: 'Failed to search ledgers' });
  }
};

/**
 * Calculate match score between search keywords and ledger
 */
function calculateMatchScore(searchKeywords, ledger) {
  let score = 0;
  
  searchKeywords.forEach(keyword => {
    // Exact name match (highest score)
    if (ledger.name.toLowerCase().includes(keyword)) {
      score += 10;
    }
    
    // Keyword match
    ledger.keywords.forEach(ledgerKeyword => {
      if (ledgerKeyword.includes(keyword)) {
        score += 5;
      }
      if (ledgerKeyword === keyword) {
        score += 8;
      }
    });
  });
  
  return score;
}

/**
 * Get expense keywords for dynamic expense detection
 */
const getExpenseKeywords = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const ledgerData = await LedgerData.find({ userId });
    
    const expenseKeywords = new Set();
    
    ledgerData.forEach(data => {
      data.ledgers.forEach(ledger => {
        // Include ledgers that are likely expenses
        if (ledger.category && ledger.category.toLowerCase().includes('expense')) {
          ledger.keywords.forEach(keyword => expenseKeywords.add(keyword));
        }
        
        // Include common expense-related ledgers
        const expenseIndicators = ['payment', 'expense', 'cost', 'charges', 'fees', 'rent', 'salary', 'freight', 'transport'];
        const ledgerLower = ledger.name.toLowerCase();
        
        if (expenseIndicators.some(indicator => ledgerLower.includes(indicator))) {
          ledger.keywords.forEach(keyword => expenseKeywords.add(keyword));
        }
      });
    });
    
    res.json({
      expenseKeywords: Array.from(expenseKeywords),
      totalKeywords: expenseKeywords.size
    });
    
  } catch (error) {
    console.error('[LEDGER] Get expense keywords error:', error);
    res.status(500).json({ error: 'Failed to get expense keywords' });
  }
};

module.exports = {
  upload,
  uploadLedgerFile,
  getUserLedgers,
  searchLedgers,
  getExpenseKeywords,
  extractLedgersFromText,
  generateKeywordsFromLedgerName
};
