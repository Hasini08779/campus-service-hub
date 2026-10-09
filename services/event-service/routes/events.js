const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const Event = require('../models/Event');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendNotification, sendAdminEventRegistrationNotification, sendNotificationsToStudents, notifyCampusStudents } = require('../utils/notifications');

const router = express.Router();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const textFields = {
  name: 150,
  description: 2000,
  venue: 150,
  organizer: 150,
};
const eventCategories = ['Workshop', 'Technical', 'Cultural', 'Sports', 'Competition', 'Seminar', 'Other'];
const eventTypes = ['individual', 'group'];

function validBody(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Request body must be a JSON object.' });
    return false;
  }
  return true;
}

function normalizeEventId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 50) {
    return null;
  }
  return value.trim().toUpperCase();
}

function eventResponse(event) {
  const data = event.toObject ? event.toObject() : { ...event };
  const registrationCount = data.registrations?.length || 0;
  delete data.registrations;
  delete data.__v;
  return { ...data, registrationCount };
}

function readEventFields(body, creating) {
  const fields = {};

  for (const [field, maxLength] of Object.entries(textFields)) {
    if (creating || body[field] !== undefined) {
      if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > maxLength) {
        return { error: `${field} must be a non-empty string of at most ${maxLength} characters.` };
      }
      fields[field] = body[field].trim();
    }
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !eventCategories.includes(body.category)) {
      return { error: `category must be one of: ${eventCategories.join(', ')}.` };
    }
    fields.category = body.category;
  }

  if (creating || body.eventType !== undefined) {
    const eventType = body.eventType === undefined && creating ? 'individual' : body.eventType;
    if (typeof eventType !== 'string' || !eventTypes.includes(eventType.toLowerCase())) {
      return { error: 'eventType must be individual or group.' };
    }
    fields.eventType = eventType.toLowerCase();
  }

  if (creating || body.maxTeamSize !== undefined) {
    const maxTeamSize = body.maxTeamSize === undefined && creating && fields.eventType === 'individual' ? 1 : Number(body.maxTeamSize);
    if (!Number.isInteger(maxTeamSize) || maxTeamSize < 1 || maxTeamSize > 100) {
      return { error: 'maxTeamSize must be a whole number between 1 and 100.' };
    }
    fields.maxTeamSize = maxTeamSize;
  }

  if (creating || body.date !== undefined) {
    if (typeof body.date !== 'string' || !datePattern.test(body.date)) {
      return { error: 'date must use YYYY-MM-DD format.' };
    }
    const date = new Date(`${body.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) {
      return { error: 'date must be a valid calendar date.' };
    }
    fields.date = date;
  }

  if (body.registrationDeadline !== undefined) {
    if (body.registrationDeadline === null || body.registrationDeadline === '') {
      fields.registrationDeadline = null;
    } else {
      if (typeof body.registrationDeadline !== 'string' || !datePattern.test(body.registrationDeadline)) {
        return { error: 'registrationDeadline must use YYYY-MM-DD format.' };
      }
      const deadline = new Date(`${body.registrationDeadline}T00:00:00.000Z`);
      if (Number.isNaN(deadline.getTime()) || deadline.toISOString().slice(0, 10) !== body.registrationDeadline) {
        return { error: 'registrationDeadline must be a valid calendar date.' };
      }
      fields.registrationDeadline = deadline;
    }
  }

  if (creating || body.time !== undefined) {
    if (typeof body.time !== 'string' || !timePattern.test(body.time)) {
      return { error: 'time must use 24-hour HH:mm format.' };
    }
    fields.time = body.time;
  }

  if (creating || body.maxParticipants !== undefined) {
    const maxParticipants = Number(body.maxParticipants);
    if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 1000000) {
      return { error: 'maxParticipants must be a whole number between 1 and 1000000.' };
    }
    fields.maxParticipants = maxParticipants;
  }

  if (!creating && Object.keys(fields).length === 0) {
    return { error: 'Provide at least one event field to update.' };
  }

  return { fields };
}

function getStudentIdentity(req) {
  const studentId = typeof req.user.studentId === 'string' ? req.user.studentId.trim().toUpperCase() : '';
  const name = typeof req.user.name === 'string' ? req.user.name.trim() : '';
  const email = typeof req.user.email === 'string' ? req.user.email.trim().toLowerCase() : '';

  if (!studentId || !name || !email) {
    return null;
  }
  return { studentId, name, email };
}

function readParticipants(body, event) {
  if (!Array.isArray(body.participants)) {
    return { error: 'Enter participant details to register.' };
  }

  const participants = body.participants.map((participant) => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) return null;
    const name = typeof participant.name === 'string' ? participant.name.trim() : '';
    const email = typeof participant.email === 'string' ? participant.email.trim().toLowerCase() : '';
    const phone = typeof participant.phone === 'string' ? participant.phone.trim() : '';
    const department = typeof participant.department === 'string' ? participant.department.trim() : '';
    const semester = Number(participant.semester);
    if (!name || name.length > 100 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !phone || phone.length > 30 || !/^\+?[0-9][0-9()\s.-]{5,29}$/.test(phone) || !department || department.length > 100
      || !Number.isInteger(semester) || semester < 1 || semester > 12) return null;
    return { name, email, phone, department, semester };
  });

  if (participants.some((participant) => !participant)) {
    return { error: 'Enter a valid name, email, phone, department, and semester for every participant.' };
  }
  const expectedCount = event.eventType === 'group' ? Number(event.maxTeamSize) : 1;
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || participants.length !== expectedCount) {
    return { error: event.eventType === 'group'
      ? `Enter exactly ${event.maxTeamSize} participants for this group event.`
      : 'Individual events require exactly one participant.' };
  }
  return { participants };
}

function startOfTodayUtc() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function eventContentFingerprint(event) {
  const content = ['name', 'description', 'category', 'eventType', 'maxTeamSize', 'date', 'registrationDeadline', 'time', 'venue', 'organizer', 'maxParticipants']
    .map((field) => [field, event[field] instanceof Date ? event[field].toISOString() : (event[field] ?? null)]);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

router.get('/', authenticateToken, requireRole('student', 'admin'), async (req, res, next) => {
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
      const escaped = req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(escaped, 'i') },
        { description: new RegExp(escaped, 'i') },
        { venue: new RegExp(escaped, 'i') },
        { organizer: new RegExp(escaped, 'i') },
        { category: new RegExp(escaped, 'i') },
      ];
    }

    const [events, total] = await Promise.all([
      Event.find(filter).sort({ date: 1, time: 1 }).skip((page - 1) * limit).limit(limit),
      Event.countDocuments(filter),
    ]);

    return res.json({
      events: events.map(eventResponse),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/registrations/me', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const identity = getStudentIdentity(req);
    if (!identity) {
      return res.status(400).json({ message: 'The token does not contain student identity details.' });
    }

    const events = await Event.find({ 'registrations.studentId': identity.studentId }).sort({ date: 1, time: 1 });
    const registrations = events.map((event) => ({
      ...eventResponse(event),
      registration: event.registrations.find((item) => item.studentId === identity.studentId),
    }));

    return res.json({ events: registrations });
  } catch (error) {
    return next(error);
  }
});

router.get('/registrations/student/:studentId', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const studentId = typeof req.params.studentId === 'string' ? req.params.studentId.trim().toUpperCase() : '';
    if (!studentId) {
      return res.status(400).json({ message: 'A valid student ID is required.' });
    }

    const events = await Event.find({ 'registrations.studentId': studentId }).sort({ date: 1, time: 1 });
    const registrations = events.flatMap((event) => event.registrations
      .filter((registration) => registration.studentId === studentId)
      .map((registration) => ({
        eventId: event.eventId,
        eventName: event.name,
        eventType: event.eventType,
        date: event.date,
        time: event.time,
        venue: event.venue,
        status: registration.status || 'Pending',
        registration: {
          studentId: registration.studentId,
          name: registration.name,
          email: registration.email,
          phone: registration.phone,
          department: registration.department,
          semester: registration.semester,
          teamName: registration.teamName,
          participants: Array.isArray(registration.participants) ? registration.participants : [],
          status: registration.status || 'Pending',
          registeredAt: registration.registeredAt,
        },
      })));

    return res.json({ registrations });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const { fields, error } = readEventFields(req.body, true);
    if (error) {
      return res.status(400).json({ message: error });
    }
    if ((fields.eventType === 'group' && fields.maxTeamSize < 2) || (fields.eventType === 'individual' && fields.maxTeamSize !== 1)) {
      return res.status(400).json({ message: 'Individual events use a team size of 1; Group events require a maximum team size of at least 2.' });
    }

    const event = await Event.create({
      eventId: `EVT-${randomUUID().toUpperCase()}`,
      ...fields,
    });
    await notifyCampusStudents(req.accessToken, {
      title: 'New Event Added',
      message: `A new event, “${event.name}”, has been added to your campus events.`,
      type: 'event_update',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      idempotencyKey: `event:new:${event.eventId}`,
    });
    return res.status(201).json({ message: 'Event created successfully.', event: eventResponse(event) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:eventId/registrations', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const eventId = normalizeEventId(req.params.eventId);
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }

    const event = await Event.findOne({ eventId });
    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    return res.json({
      eventId: event.eventId,
      eventName: event.name,
      registrations: event.registrations,
      total: event.registrations.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:eventId/register', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    const eventId = normalizeEventId(req.params.eventId);
    const studentId = typeof req.user.studentId === 'string' ? req.user.studentId.trim().toUpperCase() : '';
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }
    if (!studentId) {
      return res.status(400).json({ message: 'The token does not contain a student ID.' });
    }
    const currentEvent = await Event.findOne({ eventId });
    if (!currentEvent) return res.status(404).json({ message: 'Event not found.' });
    const { participants, error: participantError } = readParticipants(req.body, currentEvent);
    if (participantError) return res.status(400).json({ message: participantError });
    const teamName = typeof req.body.teamName === 'string' ? req.body.teamName.trim() : '';
    if (currentEvent.eventType === 'group' && (!teamName || teamName.length > 100)) {
      return res.status(400).json({ message: 'Enter a team name of 1 to 100 characters.' });
    }
    const leadParticipant = participants[0];
    const registrationRecord = {
      studentId,
      name: leadParticipant.name,
      email: leadParticipant.email,
      ...(leadParticipant.phone ? { phone: leadParticipant.phone } : {}),
      ...(leadParticipant.department ? { department: leadParticipant.department } : {}),
      ...(leadParticipant.semester ? { semester: leadParticipant.semester } : {}),
      ...(currentEvent.eventType === 'group' ? { teamName } : {}),
      participants,
      status: 'Pending',
    };

    const event = await Event.findOneAndUpdate(
      {
        eventId,
        status: { $ne: 'cancelled' },
        date: { $gte: startOfTodayUtc() },
        $or: [
          { registrationDeadline: { $exists: false } },
          { registrationDeadline: null },
          { registrationDeadline: { $gte: startOfTodayUtc() } },
        ],
        'registrations.studentId': { $ne: studentId },
        $expr: {
          $lt: [
            { $size: { $ifNull: ['$registrations', []] } },
            '$maxParticipants',
          ],
        },
      },
      { $push: { registrations: registrationRecord } },
      { new: true },
    );

    if (!event) {
      const latestEvent = await Event.findOne({ eventId });
      if (!latestEvent) {
        return res.status(404).json({ message: 'Event not found.' });
      }
      if (latestEvent.registrations.some((item) => item.studentId === studentId)) {
        return res.status(409).json({ message: 'You are already registered for this event.' });
      }
      if (latestEvent.status === 'cancelled') {
        return res.status(409).json({ message: 'This event has been cancelled.' });
      }
      if (latestEvent.date < startOfTodayUtc()) {
        return res.status(409).json({ message: 'Registration is closed for past events.' });
      }
      if (latestEvent.registrationDeadline && latestEvent.registrationDeadline < startOfTodayUtc()) {
        return res.status(409).json({ message: 'The event registration deadline has passed.' });
      }
      return res.status(409).json({ message: 'This event has reached its participant limit.' });
    }

    const registration = event.registrations.find((item) => item.studentId === studentId);
    const registeredAt = new Date(registration?.registeredAt || Date.now()).getTime() || Date.now();
    await sendNotification(req.accessToken, {
      userId: studentId,
      title: 'Registration Pending',
      message: `Your registration for ${event.name} is pending Admin approval.`,
      type: 'event_registration',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      registrationStatus: 'Pending',
      idempotencyKey: `event:registration:${event.eventId}:${studentId}:${registeredAt}`,
    });
    await sendAdminEventRegistrationNotification(req.accessToken, {
      action: 'create',
      title: 'Event Registration Pending',
      message: `${registration.participants.length} participant${registration.participants.length === 1 ? '' : 's'} registered for ${event.name}. Review the details and choose Accept or Reject.`,
      type: 'event_registration_pending',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      registrationStudentId: studentId,
      registrationParticipants: registration.participants,
      registrationStatus: 'Pending',
      idempotencyKey: `event:registration-pending:${event.eventId}:${studentId}:${registeredAt}`,
    });

    return res.status(201).json({ message: 'Event registration successful.', event: eventResponse(event), registration });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:eventId/registrations/:studentId/status', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) return;
    const eventId = normalizeEventId(req.params.eventId);
    const studentId = typeof req.params.studentId === 'string' ? req.params.studentId.trim().toUpperCase() : '';
    const status = req.body.status;
    if (!eventId || !studentId || studentId.length > 100) {
      return res.status(400).json({ message: 'A valid event ID and registration student ID are required.' });
    }
    if (!['Accepted', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Registration status must be Accepted or Rejected.' });
    }

    const event = await Event.findOneAndUpdate(
      {
        eventId,
        registrations: {
          $elemMatch: {
            studentId,
            $or: [{ status: 'Pending' }, { status: { $exists: false } }],
          },
        },
      },
      { $set: { 'registrations.$.status': status } },
      { new: true, runValidators: true },
    );
    if (!event) {
      const currentEvent = await Event.findOne({ eventId });
      if (!currentEvent) return res.status(404).json({ message: 'Event not found.' });
      const existingRegistration = currentEvent.registrations.find((registration) => registration.studentId === studentId);
      if (!existingRegistration) return res.status(404).json({ message: 'Event registration not found.' });
      if ((existingRegistration.status || 'Pending') === status) {
        return res.json({ message: `Registration is already ${status.toLowerCase()}.`, registration: existingRegistration });
      }
      return res.status(409).json({ message: 'This registration has already been reviewed.' });
    }

    const registration = event.registrations.find((item) => item.studentId === studentId);
    const registeredAt = new Date(registration.registeredAt || Date.now()).getTime() || Date.now();
    await sendNotification(req.accessToken, {
      userId: studentId,
      title: `Registration ${status}`,
      message: `Your registration for ${event.name} was ${status.toLowerCase()} by Admin.`,
      type: 'event_registration',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      registrationStatus: status,
      idempotencyKey: `event:registration-decision:${event.eventId}:${studentId}:${registeredAt}:${status.toLowerCase()}`,
    });
    await sendAdminEventRegistrationNotification(req.accessToken, {
      action: 'update-status',
      relatedEntityId: event.eventId,
      registrationStudentId: studentId,
      registrationStatus: status,
      idempotencyKey: `event:registration-pending:${event.eventId}:${studentId}:${registeredAt}`,
    });

    return res.json({ message: `Registration ${status.toLowerCase()} successfully.`, event: eventResponse(event), registration });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:eventId/register', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const eventId = normalizeEventId(req.params.eventId);
    const identity = getStudentIdentity(req);
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }
    if (!identity) {
      return res.status(400).json({ message: 'The token does not contain a student ID.' });
    }

    const previousEvent = await Event.findOne({ eventId, 'registrations.studentId': identity.studentId }).select('name registrations');
    const registration = previousEvent?.registrations.find((item) => item.studentId === identity.studentId);
    const event = await Event.findOneAndUpdate(
      { eventId, 'registrations.studentId': identity.studentId },
      { $pull: { registrations: { studentId: identity.studentId } } },
      { new: true },
    );

    if (!event) {
      const exists = await Event.exists({ eventId });
      if (!exists) {
        return res.status(404).json({ message: 'Event not found.' });
      }
      return res.status(404).json({ message: 'Registration not found.' });
    }

    const registeredAt = registration?.registeredAt instanceof Date ? registration.registeredAt.getTime() : String(registration?.registeredAt || 'unknown');
    await sendNotification(req.accessToken, {
      userId: identity.studentId,
      title: 'Registration Cancelled',
      message: `Your registration for ${event.name} has been cancelled.`,
      type: 'event_registration',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      idempotencyKey: `event:registration-cancelled:${event.eventId}:${identity.studentId}:${registeredAt}`,
    });

    return res.json({ message: 'Event registration cancelled successfully.', event: eventResponse(event) });
  } catch (error) {
    return next(error);
  }
});

router.put('/:eventId', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    if (!validBody(req, res)) {
      return;
    }

    const eventId = normalizeEventId(req.params.eventId);
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }

    const currentEvent = await Event.findOne({ eventId });
    if (!currentEvent) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    const { fields, error } = readEventFields(req.body, false);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const resultingEventType = fields.eventType ?? currentEvent.eventType ?? 'individual';
    const resultingMaxTeamSize = fields.maxTeamSize ?? currentEvent.maxTeamSize ?? 1;
    if ((resultingEventType === 'group' && resultingMaxTeamSize < 2) || (resultingEventType === 'individual' && resultingMaxTeamSize !== 1)) {
      return res.status(400).json({ message: 'Individual events use a team size of 1; Group events require a maximum team size of at least 2.' });
    }
    if (currentEvent.registrations.some((registration) => (registration.participants?.length || 1) > resultingMaxTeamSize)) {
      return res.status(409).json({ message: 'Maximum team size cannot be lower than an existing registration.' });
    }
    const resultingCapacity = fields.maxParticipants ?? currentEvent.maxParticipants;
    if (resultingCapacity < currentEvent.registrations.length) {
      return res.status(409).json({ message: 'maxParticipants cannot be lower than the current registration count.' });
    }

    const changed = Object.entries(fields).some(([field, value]) => {
      const currentValue = currentEvent[field];
      return currentValue instanceof Date && value instanceof Date
        ? currentValue.getTime() !== value.getTime()
        : currentValue !== value;
    });
    if (!changed) {
      return res.json({ message: 'Event details are already up to date.', event: eventResponse(currentEvent) });
    }

    const event = await Event.findOneAndUpdate({ eventId }, { $set: fields }, { new: true, runValidators: true });
    if (event.registrations.length > 0) {
      await sendNotificationsToStudents(req.accessToken, event.registrations.map((registration) => registration.studentId), {
        title: 'Event Updated',
        message: `The details for “${event.name}” have been updated. Please review the latest information.`,
        type: 'event_update',
        relatedEntityType: 'event',
        relatedEntityId: event.eventId,
        idempotencyKey: `event:update:${event.eventId}:${eventContentFingerprint(currentEvent)}:${eventContentFingerprint(event)}`,
      });
    }

    return res.json({ message: 'Event updated successfully.', event: eventResponse(event) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:eventId', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const eventId = normalizeEventId(req.params.eventId);
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }

    const event = await Event.findOneAndUpdate(
      { eventId, status: { $ne: 'cancelled' } },
      { $set: { status: 'cancelled' } },
      { new: true, runValidators: true },
    );
    if (!event) {
      const existing = await Event.findOne({ eventId });
      if (!existing) return res.status(404).json({ message: 'Event not found.' });
      return res.json({ message: 'Event is already cancelled.', event: eventResponse(existing) });
    }

    if (event.registrations.length > 0) {
      await sendNotificationsToStudents(req.accessToken, event.registrations.map((registration) => registration.studentId), {
        title: 'Event Cancelled',
        message: `The event “${event.name}” has been cancelled.`,
        type: 'event_update',
        relatedEntityType: 'event',
        relatedEntityId: event.eventId,
        idempotencyKey: `event:cancelled:${event.eventId}`,
      });
    }

    return res.json({ message: 'Event cancelled successfully.', event: eventResponse(event) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:eventId', authenticateToken, requireRole('student', 'admin'), async (req, res, next) => {
  try {
    const eventId = normalizeEventId(req.params.eventId);
    if (!eventId) {
      return res.status(400).json({ message: 'A valid event ID is required.' });
    }

    const event = await Event.findOne({ eventId });
    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    return res.json({ event: eventResponse(event) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
