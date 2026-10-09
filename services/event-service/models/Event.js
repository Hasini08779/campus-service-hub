const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    department: { type: String, required: true, trim: true, maxlength: 100 },
    semester: { type: Number, required: true, min: 1, max: 12 },
  },
  { _id: false },
);

const registrationSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 30 },
    department: { type: String, trim: true, maxlength: 100 },
    semester: { type: Number, min: 1, max: 12 },
    teamName: { type: String, trim: true, maxlength: 100 },
    participants: { type: [participantSchema], default: [] },
    status: { type: String, enum: ['Pending', 'Accepted', 'Rejected'], default: 'Pending' },
    registeredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 50 },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: String, enum: ['Workshop', 'Technical', 'Cultural', 'Sports', 'Competition', 'Seminar', 'Other'], default: 'Other' },
    eventType: { type: String, enum: ['individual', 'group'], default: 'individual', lowercase: true },
    maxTeamSize: { type: Number, default: 1, min: 1, max: 100 },
    date: { type: Date, required: true },
    registrationDeadline: { type: Date, default: null },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled', lowercase: true },
    time: { type: String, required: true, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/ },
    venue: { type: String, required: true, trim: true, maxlength: 150 },
    organizer: { type: String, required: true, trim: true, maxlength: 150 },
    maxParticipants: { type: Number, required: true, min: 1, max: 1000000 },
    registrations: { type: [registrationSchema], default: [] },
  },
  { timestamps: true },
);

eventSchema.index({ date: 1 });
eventSchema.index({ registrationDeadline: 1, status: 1, date: 1 });

module.exports = mongoose.model('Event', eventSchema);
