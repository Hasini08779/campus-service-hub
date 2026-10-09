const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
      required() {
        return this.role === 'student';
      },
    },
    name: {
      type: String,
      trim: true,
      required() {
        return this.role === 'student';
      },
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
    password: {
      type: String,
      required: true,
      minlength: 8,
      maxlength: 72,
      validate: {
        validator(value) {
          return Buffer.byteLength(value, 'utf8') <= 72;
        },
        message: 'Password must not exceed 72 UTF-8 bytes.',
      },
      select: false,
    },
    department: {
      type: String,
      trim: true,
      required() {
        return this.role === 'student';
      },
      maxlength: 100,
    },
    semester: {
      type: Number,
      min: 1,
      max: 12,
      required() {
        return this.role === 'student';
      },
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
      required: true,
    },
  },
  { timestamps: true },
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
