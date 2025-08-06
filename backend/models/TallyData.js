const mongoose = require('mongoose');

const TallyDataSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // User identifier (can be IP, session, or actual user ID)
  sessionId: String, // Keep for backward compatibility, but not required
  originalFileName: String,
  uploadedAt: { type: Date, default: Date.now },
  dataChunks: [
    {
      content: String,
      embedding: [Number],
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient user-based queries
TallyDataSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('TallyData', TallyDataSchema);