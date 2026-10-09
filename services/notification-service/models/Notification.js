const mongoose = require('mongoose');

const notificationTypes = [
  'event_registration',
  'event_registration_pending',
  'event_update',
  'event_deadline_reminder',
  'complaint_status_change',
  'complaint_reopened',
  'complaint_submitted',
  'complaint_feedback',
  'campus_announcement',
];

const registrationParticipantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  department: { type: String, required: true, trim: true, maxlength: 100 },
  semester: { type: Number, required: true, min: 1, max: 12 },
}, { _id: false });

const notificationSchema = new mongoose.Schema(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      index: true,
    },
    audienceRole: {
      type: String,
      enum: ['admin'],
    },
    title: {
      type: String,
      trim: true,
      maxlength: 150,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      required: true,
      enum: notificationTypes,
    },
    relatedEntityType: {
      type: String,
      enum: ['event', 'complaint'],
    },
    relatedEntityId: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    registrationStudentId: { type: String, trim: true, uppercase: true, maxlength: 100 },
    registrationParticipants: { type: [registrationParticipantSchema], default: undefined },
    registrationStatus: { type: String, enum: ['Pending', 'Accepted', 'Rejected'] },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    createdDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
      required: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, read: 1, createdDate: -1 });
notificationSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.notificationTypes = notificationTypes;
