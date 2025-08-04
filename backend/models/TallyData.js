const mongoose = require('mongoose');

const TallyDataSchema = new mongoose.Schema({
  sessionId: String,
  originalFileName: String,
  dataChunks: [
    {
      content: String,
      embedding: [Number],
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TallyData', TallyDataSchema);