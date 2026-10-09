const { randomUUID } = require('node:crypto');
const express = require('express');
const Complaint = require('../models/Complaint');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendNotification, notifyAdmin, buildResolutionNotification } = require('../utils/notifications');
const { calculateComplaintStats } = require('../utils/complaint-metrics');

const router = express.Router();
const statuses = ['Pending', 'In Progress', 'Resolved'];

function validBody(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Request body must be a JSON object.' });
    return false;
  }
  return true;
}

function normalizeComplaintId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 50) {
    return null;
  }
  return value.trim().toUpperCase();
}

function getStudentId(req) {
  return typeof req.user.studentId === 'string' ? req.user.studentId.trim().toUpperCase() : '';
}

function validateText(value, field, minLength, maxLength) {
  if (typeof value !== 'string' || value.trim().length < minLength || value.trim().length > maxLength) {
    return `${field} must be between ${minLength} and ${maxLength} characters.`;
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.post('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const studentId = getStudentId(req);
    if (!studentId) {
      return res.status(400).json({ message: 'The token does not contain a student ID.' });
    }

    const validationError = validateText(req.body.category, 'category', 2, 80)
      || validateText(req.body.subject, 'subject', 3, 150)
      || validateText(req.body.description, 'description', 10, 5000);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const submittedAt = new Date();
    const complaint = await Complaint.create({
      complaintId: `CMP-${randomUUID().toUpperCase()}`,
      studentId,
      category: req.body.category.trim(),
      subject: req.body.subject.trim(),
      description: req.body.description.trim(),
      status: 'Pending',
      createdDate: submittedAt,
      statusHistory: [{ status: 'Pending', changedAt: submittedAt }],
    });

    await sendNotification(req.accessToken, {
      userId: studentId,
      title: 'Complaint Submitted',
      message: `Your complaint “${complaint.subject}” was submitted successfully.`,
      type: 'complaint_status_change',
      relatedEntityType: 'complaint',
      relatedEntityId: complaint.complaintId,
      idempotencyKey: `complaint:submitted:${complaint.complaintId}`,
    });
    await notifyAdmin({
      title: 'New Complaint Submitted',
      message: `A new complaint "${complaint.subject}" has been submitted.`,
      type: 'complaint_submitted',
      relatedEntityType: 'complaint',
      relatedEntityId: complaint.complaintId,
      idempotencyKey: `complaint:admin-submitted:${complaint.complaintId}`,
    });

    return res.status(201).json({ message: 'Complaint submitted successfully.', complaint });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const studentId = getStudentId(req);
    if (!studentId) {
      return res.status(400).json({ message: 'The token does not contain a student ID.' });
    }

    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Page must be positive and limit must be between 1 and 100.' });
    }

    const filter = { studentId };
    if (req.query.status !== undefined) {
      if (!statuses.includes(req.query.status)) {
        return res.status(400).json({ message: 'Status must be Pending, In Progress, or Resolved.' });
      }
      filter.status = req.query.status;
    }

    const [complaints, total] = await Promise.all([
      Complaint.find(filter).select('-__v').sort({ createdDate: -1 }).skip((page - 1) * limit).limit(limit),
      Complaint.countDocuments(filter),
    ]);

    return res.json({
      complaints,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
    if (req.query.status !== undefined) {
      if (!statuses.includes(req.query.status)) {
        return res.status(400).json({ message: 'Status must be Pending, In Progress, or Resolved.' });
      }
      filter.status = req.query.status;
    }
    if (req.query.category !== undefined) {
      if (typeof req.query.category !== 'string' || !req.query.category.trim() || req.query.category.trim().length > 80) {
        return res.status(400).json({ message: 'Category filter must be a non-empty string of at most 80 characters.' });
      }
      filter.category = new RegExp(`^${escapeRegExp(req.query.category.trim())}$`, 'i');
    }
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== 'string' || req.query.q.trim().length > 100) {
        return res.status(400).json({ message: 'Search text must be at most 100 characters.' });
      }
      const search = new RegExp(escapeRegExp(req.query.q.trim()), 'i');
      filter.$or = [
        { complaintId: search },
        { studentId: search },
        { subject: search },
        { description: search },
      ];
    }

    const [complaints, total] = await Promise.all([
      Complaint.find(filter).select('-__v').sort({ createdDate: -1 }).skip((page - 1) * limit).limit(limit),
      Complaint.countDocuments(filter),
    ]);

    return res.json({
      complaints,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const complaints = await Complaint.find({}).select('status createdDate resolvedAt statusHistory').lean();
    return res.json({ stats: calculateComplaintStats(complaints) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:complaintId/status', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const complaintId = normalizeComplaintId(req.params.complaintId);
    if (!complaintId) {
      return res.status(400).json({ message: 'A valid complaint ID is required.' });
    }
    if (!statuses.includes(req.body.status)) {
      return res.status(400).json({ message: 'Status must be Pending, In Progress, or Resolved.' });
    }
    if (req.body.resolutionNote !== undefined && (typeof req.body.resolutionNote !== 'string' || req.body.resolutionNote.trim().length > 500)) {
      return res.status(400).json({ message: 'Resolution note must be a string of at most 500 characters.' });
    }

    const current = await Complaint.findOne({ complaintId });
    if (!current) {
      return res.status(404).json({ message: 'Complaint not found.' });
    }
    if (current.status === req.body.status) {
      if (current.status === 'Resolved') {
        const complaint = current.resolutionMessage
          ? current
          : await Complaint.findOneAndUpdate(
            { complaintId },
            { $set: { resolutionMessage: 'Your complaint has been resolved.' } },
            { new: true, runValidators: true, timestamps: false },
          );
        await sendNotification(req.accessToken, buildResolutionNotification(complaint));
        return res.json({ message: 'Complaint is already resolved.', complaint });
      }
      return res.json({ message: 'Complaint already has this status.', complaint: current });
    }

    const changedAt = new Date();
    const update = {
      $set: { status: req.body.status },
      $push: { statusHistory: {
        status: req.body.status,
        changedAt,
        ...(req.body.status === 'Resolved' && req.body.resolutionNote?.trim() ? { resolutionNote: req.body.resolutionNote.trim() } : {}),
      } },
    };
    if (req.body.status === 'Resolved') {
      update.$set.resolutionMessage = 'Your complaint has been resolved.';
      update.$set.resolvedAt = changedAt;
      const priorResolutionCount = (current.statusHistory || []).filter((entry) => entry.status === 'Resolved').length;
      update.$set.resolutionCycle = Math.max(Number(current.resolutionCycle) || 0, priorResolutionCount) + 1;
      if (req.body.resolutionNote?.trim()) update.$set.resolutionNote = req.body.resolutionNote.trim();
      else update.$unset = { resolutionNote: 1 };
    } else {
      update.$unset = { resolutionMessage: 1, resolutionNote: 1, resolutionConfirmedAt: 1, resolvedAt: 1 };
    }
    const complaint = await Complaint.findOneAndUpdate(
      { complaintId, status: current.status },
      update,
      { new: true, runValidators: true },
    );
    if (!complaint) {
      return res.status(409).json({ message: 'The complaint changed while you were updating it. Refresh and try again.' });
    }

    const notification = complaint.status === 'Resolved' ? buildResolutionNotification(complaint) : {
      userId: complaint.studentId,
      title: 'Complaint Update',
      message: `Your complaint "${complaint.subject}" is now ${complaint.status}.`,
      type: 'complaint_status_change',
      relatedEntityType: 'complaint',
      relatedEntityId: complaint.complaintId,
      idempotencyKey: `complaint:status:${complaint.complaintId}:${complaint.updatedAt.getTime()}`,
    };
    await sendNotification(req.accessToken, notification);

    return res.json({ message: 'Complaint status updated successfully.', complaint });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:complaintId/reopen', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const complaintId = normalizeComplaintId(req.params.complaintId);
    const studentId = getStudentId(req);
    if (!complaintId || !studentId) {
      return res.status(400).json({ message: 'A valid complaint ID and student ID are required.' });
    }

    const changedAt = new Date();
    const complaint = await Complaint.findOneAndUpdate(
      { complaintId, studentId, status: 'Resolved' },
      {
        $set: { status: 'In Progress' },
        $unset: { resolutionMessage: 1, resolutionNote: 1, resolutionConfirmedAt: 1, resolvedAt: 1 },
        $push: { statusHistory: { status: 'In Progress', changedAt, event: 'reopened' } },
      },
      { new: true, runValidators: true },
    );
    if (!complaint) {
      const existing = await Complaint.findOne({ complaintId, studentId });
      if (!existing) return res.status(404).json({ message: 'Complaint not found.' });
      return res.status(409).json({ message: 'Only a resolved complaint can be reopened.' });
    }

    await notifyAdmin({
      title: 'Complaint Reopened',
      message: `The student has reopened '${complaint.subject}' because the issue was not resolved.`,
      type: 'complaint_reopened',
      relatedEntityType: 'complaint',
      relatedEntityId: complaint.complaintId,
      idempotencyKey: `complaint:reopened:${complaint.complaintId}:${changedAt.getTime()}`,
    });
    return res.json({ message: 'Complaint reopened and the campus team has been notified.', complaint });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:complaintId/acknowledge-resolution', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const complaintId = normalizeComplaintId(req.params.complaintId);
    const studentId = getStudentId(req);
    if (!complaintId || !studentId) {
      return res.status(400).json({ message: 'A valid complaint ID and student ID are required.' });
    }
    const complaint = await Complaint.findOne({ complaintId, studentId });
    if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });
    if (complaint.status !== 'Resolved') return res.status(409).json({ message: 'Only a resolved complaint can be confirmed.' });
    if (complaint.resolutionConfirmedAt) return res.json({ message: 'Resolution already confirmed.', complaint });

    complaint.resolutionConfirmedAt = new Date();
    await complaint.save();
    return res.json({ message: 'Resolution confirmed.', complaint });
  } catch (error) {
    return next(error);
  }
});

router.post('/:complaintId/feedback', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    const complaintId = normalizeComplaintId(req.params.complaintId);
    const studentId = getStudentId(req);
    if (!complaintId || !studentId) {
      return res.status(400).json({ message: 'A valid complaint ID and student ID are required.' });
    }
    const { rating, comment } = req.body;
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' });
    }
    if (comment !== undefined && (typeof comment !== 'string' || comment.trim().length > 500)) {
      return res.status(400).json({ message: 'Feedback must be a string of at most 500 characters.' });
    }
    if (rating === undefined && !comment?.trim()) {
      return res.status(400).json({ message: 'Provide a rating or short feedback before submitting.' });
    }

    const complaint = await Complaint.findOne({ complaintId, studentId });
    if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });
    if (complaint.status !== 'Resolved') return res.status(409).json({ message: 'Feedback is available after a complaint is resolved.' });
    const cycle = Math.max(Number(complaint.resolutionCycle) || 0, (complaint.statusHistory || []).filter((entry) => entry.status === 'Resolved').length, 1);
    const resolvedAt = complaint.resolvedAt || [...(complaint.statusHistory || [])].reverse().find((entry) => entry.status === 'Resolved')?.changedAt;
    const feedbackHistory = Array.isArray(complaint.resolutionFeedbackHistory) ? complaint.resolutionFeedbackHistory : [];
    const hasCurrentCycleFeedback = feedbackHistory.some((entry) => entry.cycle === cycle)
      || (complaint.resolutionFeedback?.submittedAt && (complaint.resolutionFeedback.cycle || 1) === cycle);
    if (hasCurrentCycleFeedback) return res.status(409).json({ message: 'Feedback has already been submitted for this resolution.' });
    if (!resolvedAt || Number.isNaN(new Date(resolvedAt).getTime())) {
      return res.status(409).json({ message: 'The resolution timestamp is unavailable. Refresh the complaint and try again.' });
    }

    const submittedAt = new Date();
    const feedback = {
      cycle,
      resolvedAt: new Date(resolvedAt),
      ...(rating !== undefined ? { rating } : {}),
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
      submittedAt,
    };
    const updated = await Complaint.findOneAndUpdate(
      {
        complaintId,
        studentId,
        status: 'Resolved',
        resolutionCycle: { $in: [cycle, null] },
        resolvedAt: { $in: [new Date(resolvedAt), null] },
        resolutionFeedbackHistory: { $not: { $elemMatch: { cycle } } },
        $or: [
          { 'resolutionFeedback.submittedAt': { $exists: false } },
          { 'resolutionFeedback.cycle': { $ne: cycle } },
        ],
      },
      { $set: { resolutionFeedback: feedback, resolutionCycle: cycle, resolvedAt: new Date(resolvedAt) }, $push: { resolutionFeedbackHistory: feedback } },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(409).json({ message: 'Feedback was already submitted for this resolution. Refresh the complaint to view it.' });

    await notifyAdmin({
      title: 'New Complaint Feedback',
      message: `Student feedback received for "${updated.subject}" — rating ${rating ?? 'N/A'}/5${comment?.trim() ? ` — ${comment.trim()}` : ''}`,
      type: 'complaint_feedback',
      relatedEntityType: 'complaint',
      relatedEntityId: updated.complaintId,
      idempotencyKey: `complaint:feedback:${updated.complaintId}:${cycle}:${submittedAt.getTime()}`,
    });

    return res.status(201).json({ message: 'Thank you for your feedback.', complaint: updated });
  } catch (error) {
    return next(error);
  }
});

router.get('/:complaintId', authenticateToken, requireRole('student', 'admin'), async (req, res, next) => {
  try {
    const complaintId = normalizeComplaintId(req.params.complaintId);
    if (!complaintId) {
      return res.status(400).json({ message: 'A valid complaint ID is required.' });
    }

    const filter = { complaintId };
    if (req.user.role === 'student') {
      const studentId = getStudentId(req);
      if (!studentId) {
        return res.status(400).json({ message: 'The token does not contain a student ID.' });
      }
      filter.studentId = studentId;
    }

    const complaint = await Complaint.findOne(filter).select('-__v');
    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found.' });
    }

    return res.json({ complaint });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
