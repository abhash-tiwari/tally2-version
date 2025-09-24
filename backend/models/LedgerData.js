const mongoose = require('mongoose');

const ledgerDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  ledgers: [{
    name: {
      type: String,
      required: true,
      index: true
    },
    category: {
      type: String, // Assets, Liabilities, Income, Expenses, etc.
      index: true
    },
    subcategory: {
      type: String // Current Assets, Fixed Assets, etc.
    },
    keywords: [{
      type: String,
      index: true
    }]
  }],
  extractedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient ledger name searches
ledgerDataSchema.index({ userId: 1, 'ledgers.name': 'text' });
ledgerDataSchema.index({ userId: 1, 'ledgers.keywords': 1 });

const LedgerData = mongoose.model('LedgerData', ledgerDataSchema);

module.exports = LedgerData;
