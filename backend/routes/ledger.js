const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const { 
  upload, 
  uploadLedgerFile, 
  getUserLedgers, 
  searchLedgers, 
  getExpenseKeywords 
} = require('../controllers/ledgerController');

// Upload ledger file
router.post('/upload', authenticateToken, upload.single('ledgerFile'), uploadLedgerFile);

// Get all ledgers for user
router.get('/list', authenticateToken, getUserLedgers);

// Search ledgers by keyword
router.get('/search', authenticateToken, searchLedgers);

// Get expense keywords for dynamic expense detection
router.get('/expense-keywords', authenticateToken, getExpenseKeywords);

module.exports = router;
