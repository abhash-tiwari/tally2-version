const PLData = require('../models/PLData');
const mongoose = require('mongoose');
const { getEmbedding } = require('../utils/embedding');
const { parseFile } = require('../utils/parseFile');
const { authenticateToken } = require('../routes/auth');

// Helper function to extract company name from P&L content
function extractCompanyName(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.includes('|') && !trimmed.includes('Particulars') && 
        !trimmed.includes('1-Apr-') && !trimmed.includes('to') && 
        trimmed.length > 5 && trimmed.length < 100) {
      return trimmed;
    }
  }
  return 'Unknown Company';
}

// Helper function to extract date range from P&L content
function extractDateRange(content) {
  const dateRangeRegex = /(\d{1,2}-[A-Za-z]{3}-\d{2})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{2})/;
  const match = content.match(dateRangeRegex);
  
  if (match) {
    const fromDate = new Date(match[1]);
    const toDate = new Date(match[2]);
    return { from: fromDate, to: toDate };
  }
  
  // Default fallback
  return { 
    from: new Date('2022-04-01'), 
    to: new Date('2025-05-31') 
  };
}

// Helper function to categorize P&L content
function categorizePLContent(content) {
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.includes('sales') || lowerContent.includes('income')) {
    return { plType: 'income', category: 'sales' };
  }
  if (lowerContent.includes('purchase') || lowerContent.includes('expenses')) {
    return { plType: 'expense', category: 'purchase' };
  }
  if (lowerContent.includes('gross profit')) {
    return { plType: 'gross_profit', category: 'profit_loss' };
  }
  if (lowerContent.includes('net profit') || lowerContent.includes('nett profit')) {
    return { plType: 'net_profit', category: 'profit_loss' };
  }
  if (lowerContent.includes('opening stock')) {
    return { plType: 'opening_stock', category: 'stock' };
  }
  if (lowerContent.includes('closing stock')) {
    return { plType: 'closing_stock', category: 'stock' };
  }
  
  return { plType: 'expense', category: 'indirect_expenses' };
}

// Helper function to extract amount from P&L line
function extractAmount(content) {
  const amountRegex = /[\d,]+\.?\d*/g;
  const matches = content.match(amountRegex);
  
  if (matches && matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const cleanAmount = lastMatch.replace(/,/g, '');
    const amount = parseFloat(cleanAmount);
    return isNaN(amount) ? null : amount;
  }
  
  return null;
}

// Upload P&L data
exports.uploadPL = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const userId = req.user.userId;
    console.log('[PL_UPLOAD] Starting P&L upload for user:', req.user.email, 'File:', file.originalname);

    // Parse file using the same utility as TallyData
    const parsedData = await parseFile(file);
    console.log('[PL_UPLOAD] File parsed. Type:', typeof parsedData);

    // Convert parsed data to text content
    let content = '';
    if (Array.isArray(parsedData)) {
      // Excel file - combine all sheets
      parsedData.forEach(sheet => {
        if (typeof sheet === 'string') {
          content += sheet + '\n';
        } else if (sheet.data) {
          sheet.data.forEach(row => {
            content += row.join(' | ') + '\n';
          });
        }
      });
    } else if (typeof parsedData === 'string') {
      // Text file
      content = parsedData;
    } else {
      // Other formats - convert to string
      content = JSON.stringify(parsedData, null, 2);
    }

    if (!content.trim()) {
      return res.status(400).json({ error: 'No content extracted from file' });
    }

    // Extract metadata
    const companyName = extractCompanyName(content);
    const dateRange = extractDateRange(content);
    
    console.log('[PL_UPLOAD] Company:', companyName);
    console.log('[PL_UPLOAD] Date range:', dateRange);

    // Split content into chunks
    const lines = content.split('\n').filter(line => line.trim());
    const chunkSize = 50; // Lines per chunk
    const chunks = [];
    
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const chunkContent = chunkLines.join('\n');
      
      if (chunkContent.trim()) {
        chunks.push({
          content: chunkContent,
          chunkIndex: Math.floor(i / chunkSize) + 1,
          totalChunks: Math.ceil(lines.length / chunkSize)
        });
      }
    }

    console.log('[PL_UPLOAD] Created', chunks.length, 'chunks');

    // Process each chunk
    const savedChunks = [];
    
    for (const chunk of chunks) {
      try {
        // Generate embedding
        const embedding = await getEmbedding(chunk.content);
        
        // Categorize content
        const { plType, category } = categorizePLContent(chunk.content);
        
        // Extract amount
        const amount = extractAmount(chunk.content);
        
        // Create month/year keys for filtering
        const monthKey = `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, '0')}`;
        const yearKey = String(dateRange.from.getFullYear());
        
        // Create P&L data document
        const plData = new PLData({
          userId,
          originalFileName: file.originalname,
          companyName,
          periodFrom: dateRange.from,
          periodTo: dateRange.to,
          content: chunk.content,
          embedding,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          monthKey,
          yearKey,
          plType,
          category,
          amount,
          embeddingError: false
        });

        const saved = await plData.save();
        savedChunks.push(saved);
        
        console.log('[PL_UPLOAD] Saved chunk', chunk.chunkIndex, 'Type:', plType, 'Category:', category);
        
      } catch (embeddingError) {
        console.error('[PL_UPLOAD] Embedding error for chunk', chunk.chunkIndex, ':', embeddingError);
        
        // Save without embedding
        const plData = new PLData({
          userId,
          originalFileName: file.originalname,
          companyName,
          periodFrom: dateRange.from,
          periodTo: dateRange.to,
          content: chunk.content,
          embedding: new Array(512).fill(0), // Fallback embedding
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          monthKey: `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, '0')}`,
          yearKey: String(dateRange.from.getFullYear()),
          plType: 'expense',
          category: 'indirect_expenses',
          amount: null,
          embeddingError: true
        });

        const saved = await plData.save();
        savedChunks.push(saved);
      }
    }

    console.log('[PL_UPLOAD] Successfully uploaded', savedChunks.length, 'P&L chunks');

    res.json({
      message: 'P&L data uploaded successfully',
      chunksUploaded: savedChunks.length,
      companyName,
      dateRange,
      fileName: file.originalname
    });

  } catch (error) {
    console.error('[PL_UPLOAD] Upload error:', error);
    res.status(500).json({ error: 'Failed to upload P&L data' });
  }
};

// Get P&L files for user
exports.getPLFiles = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const files = await PLData.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$originalFileName',
          originalFileName: { $first: '$originalFileName' },
          companyName: { $first: '$companyName' },
          periodFrom: { $first: '$periodFrom' },
          periodTo: { $first: '$periodTo' },
          totalChunks: { $first: '$totalChunks' },
          uploadedAt: { $first: '$uploadedAt' }
        }
      },
      { $sort: { uploadedAt: -1 } }
    ]);

    console.log('[PL_GET_FILES] Found', files.length, 'P&L files for user:', userId);
    console.log('[PL_GET_FILES] Sample file structure:', files[0]);
    
    res.json({ files });
    
  } catch (error) {
    console.error('[PL_GET_FILES] Error:', error);
    res.status(500).json({ error: 'Failed to get P&L files' });
  }
};

// Delete P&L file
exports.deletePLFile = async (req, res) => {
  try {
    const { fileName } = req.params;
    const userId = req.user.userId;

    const result = await PLData.deleteMany({ 
      userId, 
      originalFileName: fileName 
    });

    console.log('[PL_DELETE] Deleted', result.deletedCount, 'chunks for file:', fileName);

    res.json({ 
      message: 'P&L file deleted successfully',
      deletedChunks: result.deletedCount 
    });

  } catch (error) {
    console.error('[PL_DELETE] Error:', error);
    res.status(500).json({ error: 'Failed to delete P&L file' });
  }
};
