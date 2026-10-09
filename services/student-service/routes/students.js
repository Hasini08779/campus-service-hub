const express = require('express');
const Student = require('../models/Student');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const phonePattern = /^\+?[\d\s().-]{7,20}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validBody(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Request body must be a JSON object.' });
    return false;
  }
  return true;
}

router.get('/me', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const studentId = String(req.user.studentId || '').trim().toUpperCase();
    if (!studentId) {
      return res.status(400).json({ message: 'The token does not contain a student ID.' });
    }

    const student = await Student.findOne({ studentId }).select('-__v');
    if (!student) {
      return res.status(404).json({ message: 'Student profile not found. Create it with PUT /api/students/me.' });
    }

    return res.json({ student });
  } catch (error) {
    return next(error);
  }
});

// Create a student's local profile on first use, or update it on later requests.
router.put('/me', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const studentId = String(req.user.studentId || '').trim().toUpperCase();
    const email = String(req.user.email || '').trim().toLowerCase();
    if (!studentId || !email || !emailPattern.test(email)) {
      return res.status(400).json({ message: 'The token is missing valid student identity details.' });
    }

    if (req.body.studentId !== undefined && String(req.body.studentId).trim().toUpperCase() !== studentId) {
      return res.status(400).json({ message: 'Student ID cannot be changed through this service.' });
    }
    if (req.body.email !== undefined && String(req.body.email).trim().toLowerCase() !== email) {
      return res.status(400).json({ message: 'Email cannot be changed through this service.' });
    }

    const existing = await Student.findOne({ studentId });
    const nameValue = req.body.name === undefined ? (existing?.name || req.user.name) : req.body.name;
    const departmentValue = req.body.department === undefined ? existing?.department : req.body.department;
    const semesterValue = req.body.semester === undefined ? existing?.semester : Number(req.body.semester);

    if (typeof nameValue !== 'string' || !nameValue.trim() || nameValue.trim().length > 100) {
      return res.status(400).json({ message: 'Name must be a non-empty string of at most 100 characters.' });
    }
    if (typeof departmentValue !== 'string' || !departmentValue.trim() || departmentValue.trim().length > 100) {
      return res.status(400).json({ message: 'Department is required and must be at most 100 characters.' });
    }
    if (!Number.isInteger(semesterValue) || semesterValue < 1 || semesterValue > 12) {
      return res.status(400).json({ message: 'Semester must be a whole number between 1 and 12.' });
    }

    let phone = existing?.phone ?? null;
    if (req.body.phone !== undefined) {
      if (req.body.phone === null || req.body.phone === '') {
        phone = null;
      } else if (typeof req.body.phone !== 'string' || !phonePattern.test(req.body.phone.trim()) || (req.body.phone.match(/\d/g) || []).length < 7) {
        return res.status(400).json({ message: 'Enter a valid phone number or leave it blank.' });
      } else {
        phone = req.body.phone.trim();
      }
    }

    const student = await Student.findOneAndUpdate(
      { studentId },
      {
        $set: {
          studentId,
          email,
          name: nameValue.trim(),
          department: departmentValue.trim(),
          semester: semesterValue,
          phone,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).select('-__v');

    return res.json({
      message: existing ? 'Student profile updated successfully.' : 'Student profile created successfully.',
      student,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Page must be positive and limit must be between 1 and 100.' });
    }

    const filter = {};
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== 'string' || req.query.q.trim().length > 100) {
        return res.status(400).json({ message: 'Search text must be at most 100 characters.' });
      }
      const search = new RegExp(escapeRegExp(req.query.q.trim()), 'i');
      filter.$or = [
        { studentId: search },
        { name: search },
        { email: search },
      ];
    }

    if (req.query.department !== undefined) {
      if (typeof req.query.department !== 'string' || !req.query.department.trim() || req.query.department.trim().length > 100) {
        return res.status(400).json({ message: 'Department filter must be a non-empty string of at most 100 characters.' });
      }
      filter.department = new RegExp(`^${escapeRegExp(req.query.department.trim())}$`, 'i');
    }

    if (req.query.semester !== undefined) {
      const semester = Number(req.query.semester);
      if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
        return res.status(400).json({ message: 'Semester filter must be a whole number between 1 and 12.' });
      }
      filter.semester = semester;
    }

    const sort = req.query.sort === undefined ? 'name' : req.query.sort;
    if (!['name', 'recent'].includes(sort)) {
      return res.status(400).json({ message: 'sort must be name or recent.' });
    }

    const [students, total] = await Promise.all([
      Student.find(filter).select('-__v').sort(sort === 'recent' ? { createdAt: -1 } : { name: 1 }).skip((page - 1) * limit).limit(limit),
      Student.countDocuments(filter),
    ]);

    return res.json({
      students,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:studentId', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const studentId = req.params.studentId.trim().toUpperCase();
    if (!studentId || studentId.length > 50) {
      return res.status(400).json({ message: 'A valid student ID is required.' });
    }

    const student = await Student.findOne({ studentId }).select('-__v');
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.json({ student });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
