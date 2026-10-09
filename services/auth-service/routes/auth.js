const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPublicUser(user) {
  return {
    id: user._id,
    studentId: user.studentId,
    name: user.name,
    email: user.email,
    department: user.department,
    semester: user.semester,
    role: user.role,
  };
}

function createToken(user) {
  return jwt.sign(
    {
      role: user.role,
      studentId: user.studentId,
      name: user.name,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      subject: user._id.toString(),
      issuer: 'campus-service-hub-auth',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    },
  );
}

router.post('/register', async (req, res, next) => {
  try {
    const { studentId, name, email, password, department, semester } = req.body || {};

    if (![studentId, name, email, password, department, semester].every((value) => value !== undefined && value !== null && String(value).trim() !== '')) {
      return res.status(400).json({ message: 'studentId, name, email, password, department, and semester are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedStudentId = String(studentId).trim().toUpperCase();
    const normalizedName = String(name).trim();
    const normalizedDepartment = String(department).trim();
    const parsedSemester = Number(semester);

    if (!emailPattern.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (String(password).length < 8 || Buffer.byteLength(String(password), 'utf8') > 72) {
      return res.status(400).json({ message: 'Password must be between 8 and 72 characters.' });
    }
    if (normalizedStudentId.length > 50 || normalizedName.length > 100 || normalizedDepartment.length > 100) {
      return res.status(400).json({ message: 'One or more fields exceed the allowed length.' });
    }
    if (!Number.isInteger(parsedSemester) || parsedSemester < 1 || parsedSemester > 12) {
      return res.status(400).json({ message: 'Semester must be a whole number between 1 and 12.' });
    }

    const user = await User.create({
      studentId: normalizedStudentId,
      name: normalizedName,
      email: normalizedEmail,
      password: String(password),
      department: normalizedDepartment,
      semester: parsedSemester,
      role: 'student',
    });

    const token = createToken(user);
    return res.status(201).json({
      message: 'Student account created successfully.',
      token,
      user: getPublicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
    const passwordMatches = user ? await user.comparePassword(password) : false;

    if (!user || !passwordMatches || (req.expectedRole && user.role !== req.expectedRole)) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    return res.json({
      message: 'Login successful.',
      token: createToken(user),
      user: getPublicUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

router.post('/login', login);
router.post('/admin/login', (req, res, next) => {
  req.expectedRole = 'admin';
  return login(req, res, next);
});

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    return res.json({ user: getPublicUser(user) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
