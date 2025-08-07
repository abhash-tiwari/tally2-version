const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken } = require('./auth');

// Protect chat route with authentication
router.post('/', authenticateToken, chatController.chat);

module.exports = router;