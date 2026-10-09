const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const Notification = require('../models/Notification');
const { notificationTypes } = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function currentUserId(user) {
  const identity = user.role === 'student' ? user.studentId : user.sub;
  return typeof identity === 'string' && identity.trim() ? identity.trim().toUpperCase() : '';
}

function normalizeUserId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    return null;
  }
  return value.trim().toUpperCase();
}

function buildUserIdMatch(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const escaped = normalizedUserId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    $or: [
      { userId: normalizedUserId },
      { userId: { $regex: `^${escaped}$`, $options: 'i' } },
    ],
  };
}

function normalizeNotificationId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 50) {
    return null;
  }
  return value.trim().toUpperCase();
}

function validBody(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Request body must be a JSON object.' });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'You do not have permission to access this resource.' });
  }
  return next();
}

function readNotificationContent(body) {
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 150)) {
    return { error: 'title must be a non-empty string of at most 150 characters.' };
  }
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 500) {
    return { error: 'message must be a non-empty string of at most 500 characters.' };
  }
  if (!notificationTypes.includes(body.type)) {
    return { error: `type must be one of: ${notificationTypes.join(', ')}.` };
  }
  if (body.relatedEntityType !== undefined && !['event', 'complaint'].includes(body.relatedEntityType)) {
    return { error: 'relatedEntityType must be event or complaint.' };
  }
  if (body.relatedEntityId !== undefined && (typeof body.relatedEntityId !== 'string' || !body.relatedEntityId.trim() || body.relatedEntityId.trim().length > 100)) {
    return { error: 'relatedEntityId must be a non-empty string of at most 100 characters.' };
  }
  if ((body.relatedEntityType === undefined) !== (body.relatedEntityId === undefined)) {
    return { error: 'relatedEntityType and relatedEntityId must be provided together.' };
  }
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.trim().length > 200)) {
    return { error: 'idempotencyKey must be a non-empty string of at most 200 characters.' };
  }
  if (body.registrationStatus !== undefined && !['Pending', 'Accepted', 'Rejected'].includes(body.registrationStatus)) {
    return { error: 'registrationStatus must be Pending, Accepted, or Rejected.' };
  }

  return {
    content: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      message: body.message.trim(),
      type: body.type,
      ...(body.relatedEntityType ? { relatedEntityType: body.relatedEntityType, relatedEntityId: body.relatedEntityId.trim() } : {}),
      ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey.trim() } : {}),
      ...(body.registrationStatus ? { registrationStatus: body.registrationStatus } : {}),
    },
  };
}

async function createOrGetNotification(userId, content, extra = {}) {
  if (!content.idempotencyKey) {
    return Notification.create({
      notificationId: `NTF-${randomUUID().toUpperCase()}`,
      userId,
      ...content,
      ...extra,
      read: false,
    });
  }

  const filter = { userId, idempotencyKey: content.idempotencyKey };
  const insert = {
    notificationId: `NTF-${randomUUID().toUpperCase()}`,
    userId,
    ...content,
    ...extra,
    read: false,
  };
  try {
    return await Notification.findOneAndUpdate(filter, { $setOnInsert: insert }, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Notification.findOne(filter);
  }
}

function verifyComplaintServiceRequest(req, res, next) {
  const timestamp = req.get('x-service-timestamp');
  const signature = req.get('x-service-signature');
  const parsedTimestamp = Number(timestamp);
  if (!process.env.JWT_SECRET || !/^\d{13}$/.test(timestamp || '') || !/^[a-f\d]{64}$/i.test(signature || '') ||
      Math.abs(Date.now() - parsedTimestamp) > 60_000) {
    return res.status(401).json({ message: 'A valid Complaint Service signature is required.' });
  }

  const expected = createHmac('sha256', process.env.JWT_SECRET)
    .update(`${timestamp}.${JSON.stringify(req.body)}`)
    .digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(401).json({ message: 'A valid Complaint Service signature is required.' });
  }
  return next();
}

function verifyEventServiceRequest(req, res, next) {
  const timestamp = req.get('x-service-timestamp');
  const signature = req.get('x-service-signature');
  const parsedTimestamp = Number(timestamp);
  if (!process.env.JWT_SECRET || !/^\d{13}$/.test(timestamp || '') || !/^[a-f\d]{64}$/i.test(signature || '') ||
      Math.abs(Date.now() - parsedTimestamp) > 60_000) {
    return res.status(401).json({ message: 'A valid Event Service signature is required.' });
  }
  const expected = createHmac('sha256', process.env.JWT_SECRET)
    .update(`${timestamp}.${JSON.stringify(req.body)}`)
    .digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(401).json({ message: 'A valid Event Service signature is required.' });
  }
  return next();
}

router.post('/internal/admin', verifyComplaintServiceRequest, async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    console.log('[DEBUG] notification-service internal/admin body', req.body);
    const { content, error } = readNotificationContent(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!['complaint_reopened', 'complaint_submitted', 'complaint_feedback'].includes(content.type) || !content.idempotencyKey || content.relatedEntityType !== 'complaint') {
      return res.status(400).json({ message: 'A deduplicated admin complaint notification is required.' });
    }

    const targetUserId = typeof req.body.userId === 'string' && req.body.userId.trim()
      ? req.body.userId.trim().toUpperCase()
      : 'ADMIN';
    console.log('[DEBUG] notification-service internal/admin targetUserId', { targetUserId, content });
    const notification = await createOrGetNotification(targetUserId, content, { audienceRole: 'admin' });
    console.log('[DEBUG] notification-service internal/admin saved', notification);
    return res.status(201).json({ message: 'Admin notification created successfully.', notification });
  } catch (error) {
    console.log('[DEBUG] notification-service internal/admin error', error);
    return next(error);
  }
});

router.post('/internal/event-registration', verifyEventServiceRequest, async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    const eventId = typeof req.body.relatedEntityId === 'string' ? req.body.relatedEntityId.trim() : '';
    const registrationStudentId = normalizeUserId(req.body.registrationStudentId);
    const idempotencyKey = typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
    if (req.body.action === 'update-status') {
      if (!eventId || !registrationStudentId || !idempotencyKey || !['Accepted', 'Rejected'].includes(req.body.registrationStatus)) {
        return res.status(400).json({ message: 'Event ID, registration student ID, idempotency key, and an Accepted/Rejected status are required.' });
      }
      const notification = await Notification.findOneAndUpdate(
        { userId: 'ADMIN', audienceRole: 'admin', relatedEntityType: 'event', relatedEntityId: eventId, registrationStudentId, idempotencyKey },
        { $set: { registrationStatus: req.body.registrationStatus } },
        { new: true, runValidators: true },
      ).select('-__v');
      if (!notification) return res.status(404).json({ message: 'Pending event registration notification not found.' });
      return res.json({ message: 'Admin registration notification updated.', notification });
    }

    const { content, error } = readNotificationContent(req.body);
    if (error) return res.status(400).json({ message: error });
    if (req.body.action !== 'create' || content.type !== 'event_registration_pending' || content.relatedEntityType !== 'event' ||
        !content.idempotencyKey || !registrationStudentId || req.body.registrationStatus !== 'Pending' ||
        !Array.isArray(req.body.registrationParticipants) || req.body.registrationParticipants.length < 1 || req.body.registrationParticipants.length > 100) {
      return res.status(400).json({ message: 'A complete pending event registration notification is required.' });
    }
    const participants = req.body.registrationParticipants.map((participant) => {
      if (!participant || typeof participant !== 'object' || Array.isArray(participant)) return null;
      const name = typeof participant.name === 'string' ? participant.name.trim() : '';
      const email = typeof participant.email === 'string' ? participant.email.trim().toLowerCase() : '';
      const phone = typeof participant.phone === 'string' ? participant.phone.trim() : '';
      const department = typeof participant.department === 'string' ? participant.department.trim() : '';
      const semester = Number(participant.semester);
      if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
          !/^\+?[0-9][0-9()\s.-]{5,29}$/.test(phone) || !department || department.length > 100 ||
          !Number.isInteger(semester) || semester < 1 || semester > 12) return null;
      return { name, email, phone, department, semester };
    });
    if (participants.some((participant) => !participant)) {
      return res.status(400).json({ message: 'Registration notification participant details are invalid.' });
    }
    const notification = await createOrGetNotification('ADMIN', content, {
      audienceRole: 'admin', registrationStudentId, registrationParticipants: participants,
    });
    return res.status(201).json({ message: 'Admin event registration notification created.', notification });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticateToken);

router.post('/', async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const ownUserId = currentUserId(req.user);
    if (!ownUserId) {
      return res.status(400).json({ message: 'The token does not contain a user ID.' });
    }

    const userId = req.body.userId === undefined ? ownUserId : normalizeUserId(req.body.userId);
    if (!userId) {
      return res.status(400).json({ message: 'A valid userId is required.' });
    }
    if (req.user.role === 'student' && userId !== ownUserId) {
      return res.status(403).json({ message: 'Students can only create notifications for themselves.' });
    }

    const { content, error } = readNotificationContent(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const notification = await createOrGetNotification(userId, content);

    return res.status(201).json({ message: 'Notification created successfully.', notification });
  } catch (error) {
    return next(error);
  }
});

router.post('/bulk', requireAdmin, async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    const { content, error } = readNotificationContent(req.body);
    if (error) return res.status(400).json({ message: error });
    if (!content.idempotencyKey) {
      return res.status(400).json({ message: 'idempotencyKey is required for bulk notifications.' });
    }
    if (!Array.isArray(req.body.userIds) || req.body.userIds.length < 1 || req.body.userIds.length > 500) {
      return res.status(400).json({ message: 'userIds must contain between 1 and 500 student IDs.' });
    }

    const userIds = [...new Set(req.body.userIds.map(normalizeUserId))];
    if (userIds.some((userId) => !userId)) {
      return res.status(400).json({ message: 'Every userId must be a valid student ID.' });
    }

    const operations = userIds.map((userId) => ({
      updateOne: {
        filter: { userId, idempotencyKey: content.idempotencyKey },
        update: {
          $setOnInsert: {
            notificationId: `NTF-${randomUUID().toUpperCase()}`,
            userId,
            ...content,
            read: false,
          },
        },
        upsert: true,
      },
    }));
    const result = await Notification.bulkWrite(operations, { ordered: false });
    return res.status(201).json({
      message: 'Campus notifications processed successfully.',
      recipients: userIds.length,
      created: result.upsertedCount,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const userId = currentUserId(req.user);
    if (!userId) {
      return res.status(400).json({ message: 'The token does not contain a user ID.' });
    }

    const userIdMatch = buildUserIdMatch(userId);
    const filter = req.user.role === 'admin'
      ? { read: false, $or: [...(userIdMatch ? userIdMatch.$or : []), { audienceRole: 'admin' }] }
      : { read: false, ...userIdMatch };
    const count = await Notification.countDocuments(filter);
    return res.json({ userId, count });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const userId = currentUserId(req.user);
    if (!userId) {
      return res.status(400).json({ message: 'The token does not contain a user ID.' });
    }

    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Page must be positive and limit must be between 1 and 100.' });
    }

    const userIdMatch = buildUserIdMatch(userId);
    const filter = req.user.role === 'admin'
      ? { $or: [...(userIdMatch ? userIdMatch.$or : []), { audienceRole: 'admin' }] }
      : userIdMatch || { userId };
    if (req.query.read !== undefined) {
      if (req.query.read !== 'true' && req.query.read !== 'false') {
        return res.status(400).json({ message: 'read filter must be true or false.' });
      }
      filter.read = req.query.read === 'true';
    }
    if (req.query.type !== undefined) {
      if (!notificationTypes.includes(req.query.type)) {
        return res.status(400).json({ message: 'The requested notification type is not supported.' });
      }
      filter.type = req.query.type;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter).select('-__v').sort({ createdDate: -1 }).skip((page - 1) * limit).limit(limit),
      Notification.countDocuments(filter),
    ]);

    return res.json({
      notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    const notificationId = normalizeNotificationId(req.params.notificationId);
    if (!notificationId) {
      return res.status(400).json({ message: 'A valid notification ID is required.' });
    }

    const userId = currentUserId(req.user);
    if (!userId) {
      return res.status(400).json({ message: 'The token does not contain a user ID.' });
    }

    const userIdMatch = buildUserIdMatch(userId);
    const notificationFilter = req.user.role === 'admin'
      ? { notificationId, $or: [...(userIdMatch ? userIdMatch.$or : []), { audienceRole: 'admin' }] }
      : { notificationId, ...(userIdMatch || { userId }) };
    const notification = await Notification.findOneAndUpdate(
      notificationFilter,
      { $set: { read: true } },
      { new: true, runValidators: true },
    ).select('-__v');

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    return res.json({ message: 'Notification marked as read.', notification });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
