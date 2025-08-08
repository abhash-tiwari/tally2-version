const express = require('express');
const multer = require('multer');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { authenticateToken } = require('./auth');



const storage = multer.memoryStorage();
const upload = multer({ storage });

// Protect upload route with authentication
router.post('/', authenticateToken, upload.single('file'), fileController.uploadFile);

// Get user files
router.get('/', authenticateToken, fileController.getUserFiles);

module.exports = router;