const mongoose = require('mongoose');

const VoucherEntrySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },

  // Normalized fields parsed from voucher lines
  date: { type: Date, required: false, index: true },
  monthKey: { type: String, required: false, index: true }, // e.g., "2023-10"
  type: { type: String, required: false, index: true },     // e.g., Sale, Purc, Rcpt, Pymt, C/Note, D/Note
  account: { type: String, required: false, index: true },
  dr: { type: Number, required: false, default: 0 },
  cr: { type: Number, required: false, default: 0 },
  narration: { type: String, required: false },

  // Original raw line for reference
  raw: { type: String, required: false }
}, { timestamps: true });

VoucherEntrySchema.index({ userId: 1, monthKey: 1, type: 1 });
VoucherEntrySchema.index({ userId: 1, type: 1, account: 1 });
// Supports efficient range queries and sorting by date for a given (userId, monthKey, type)
VoucherEntrySchema.index({ userId: 1, monthKey: 1, type: 1, date: 1 });

module.exports = mongoose.model('VoucherEntry', VoucherEntrySchema);
