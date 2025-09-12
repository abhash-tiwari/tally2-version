const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticateToken } = require('./auth');
const { uploadPL, getPLFiles, deletePLFile } = require('../controllers/plController');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload P&L data
router.post('/upload', authenticateToken, upload.single('file'), uploadPL);

// Get P&L files for user
router.get('/files', authenticateToken, getPLFiles);

// Delete P&L file
router.delete('/files/:fileName', authenticateToken, deletePLFile);

module.exports = router;
