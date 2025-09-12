const mongoose = require('mongoose');

const PLDataSchema = new mongoose.Schema({
  // User identification
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // File metadata
  originalFileName: {
    type: String,
    required: true
  },
  
  // P&L specific metadata
  companyName: {
    type: String,
    required: true
  },
  
  periodFrom: {
    type: Date,
    required: true
  },
  
  periodTo: {
    type: Date,
    required: true
  },
  
  // Content and embeddings (similar to TallyData)
  content: {
    type: String,
    required: true
  },
  
  embedding: {
    type: [Number],
    required: true
  },
  
  // Chunking information
  chunkIndex: {
    type: Number,
    required: true
  },
  
  totalChunks: {
    type: Number,
    required: true
  },
  
  // Date-based filtering support
  monthKey: {
    type: String,
    index: true
  },
  
  yearKey: {
    type: String,
    index: true
  },
  
  // Embedding processing status
  embeddingError: {
    type: Boolean,
    default: false
  },
  
  // P&L specific fields for better querying
  plType: {
    type: String,
    enum: ['income', 'expense', 'gross_profit', 'net_profit', 'opening_stock', 'closing_stock'],
    index: true
  },
  
  // Financial categories
  category: {
    type: String,
    enum: [
      'sales', 'purchase', 'direct_expenses', 'direct_incomes', 
      'indirect_expenses', 'indirect_incomes', 'stock', 'profit_loss'
    ],
    index: true
  },
  
  // Amount extracted from the content (if applicable)
  amount: {
    type: Number,
    default: null
  },
  
  // Upload timestamp
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
PLDataSchema.index({ userId: 1, monthKey: 1 });
PLDataSchema.index({ userId: 1, yearKey: 1 });
PLDataSchema.index({ userId: 1, plType: 1 });
PLDataSchema.index({ userId: 1, category: 1 });
PLDataSchema.index({ userId: 1, periodFrom: 1, periodTo: 1 });

// Text search index for content
PLDataSchema.index({ content: 'text' });

module.exports = mongoose.model('PLData', PLDataSchema);
