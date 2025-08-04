const express = require('express');
const multer = require('multer');
const router = express.Router();
const fileController = require('../controllers/fileController');

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/', upload.single('file'), fileController.uploadFile);

module.exports = router;