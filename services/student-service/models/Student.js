const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    department: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    semester: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      validate: {
        validator: Number.isInteger,
        message: 'Semester must be a whole number.',
      },
    },
    phone: {
      type: String,
      default: null,
      trim: true,
      maxlength: 20,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Student', studentSchema);
