const mongoose = require('mongoose');
const complaintStatuses = ['Pending', 'In Progress', 'Resolved'];

const complaintStatusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: complaintStatuses, required: true },
    changedAt: { type: Date, required: true },
    event: { type: String, enum: ['status_change', 'reopened'], default: 'status_change' },
    resolutionNote: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const resolutionFeedbackHistorySchema = new mongoose.Schema(
  {
    cycle: { type: Number, required: true, min: 1 },
    resolvedAt: { type: Date, required: true },
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500 },
    submittedAt: { type: Date, required: true },
  },
  { _id: false },
);

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    studentId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    resolutionMessage: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    resolutionNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    resolutionConfirmedAt: Date,
    resolutionFeedback: {
      cycle: { type: Number, min: 1 },
      resolvedAt: Date,
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, trim: true, maxlength: 500 },
      submittedAt: Date,
    },
    resolutionCycle: { type: Number, default: 0, min: 0 },
    resolutionFeedbackHistory: {
      type: [resolutionFeedbackHistorySchema],
      default: [],
    },
    createdDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    status: {
      type: String,
      enum: complaintStatuses,
      default: 'Pending',
      required: true,
    },
    resolvedAt: Date,
    statusHistory: {
      type: [complaintStatusHistorySchema],
      default: [],
    },
  },
  { timestamps: true },
);

complaintSchema.index({ createdDate: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
