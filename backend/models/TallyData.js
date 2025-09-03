const mongoose = require('mongoose');

const TallyDataSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // User identifier (can be IP, session, or actual user ID)
  sessionId: { type: String, required: false, index: true }, // Keep for backward compatibility, but not required
  userEmail: { type: String, required: false, index: true },
  originalFileName: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  dataChunks: [
    {
      content: String,
      embedding: [Number],
      chunkIndex: Number,
      totalChunks: Number,
      monthKey: { type: String, required: false }, // e.g., "2025-03" identifying the month this chunk represents
      embeddingError: { type: Boolean, default: false }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient user-based queries
TallyDataSchema.index({ userId: 1, createdAt: -1 });
// Index to efficiently filter by month within embedded dataChunks
TallyDataSchema.index({ userId: 1, 'dataChunks.monthKey': 1, createdAt: -1 });

module.exports = mongoose.model('TallyData', TallyDataSchema);