const { createHmac } = require('node:crypto');
const Event = require('../models/Event');
const { sendNotificationsToStudents, getCampusStudentIds } = require('./notifications');

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayUtc(now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function getReminderStage(deadline, now = new Date()) {
  if (!deadline) return null;
  const deadlineDate = new Date(deadline);
  if (Number.isNaN(deadlineDate.getTime())) return null;
  const remainingDays = Math.round((deadlineDate.getTime() - startOfTodayUtc(now).getTime()) / DAY_MS);
  if (remainingDays === 3) return '3d';
  if (remainingDays === 1) return '1d';
  if (remainingDays === 0) return 'today';
  return null;
}

function isReminderCandidate(event, now = new Date()) {
  if (event.status === 'cancelled' || !getReminderStage(event.registrationDeadline, now)) return false;
  if (new Date(event.date) < startOfTodayUtc(now)) return false;
  const registrations = Array.isArray(event.registrations) ? event.registrations : [];
  if (registrations.length >= Number(event.maxParticipants)) return false;
  return true;
}

function getReminderRecipients(event, studentIds) {
  const registered = new Set((Array.isArray(event.registrations) ? event.registrations : [])
    .map((registration) => String(registration.studentId || '').trim().toUpperCase()));
  return studentIds.filter((studentId) => !registered.has(String(studentId).trim().toUpperCase()));
}

function createServiceAdminToken() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to run event reminder delivery.');
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'campus-service-hub-auth',
    sub: 'campus-event-service',
    role: 'admin',
    iat: issuedAt,
    exp: issuedAt + 5 * 60,
  });
  const message = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(message).digest('base64url');
  return `${message}.${signature}`;
}

async function runDeadlineReminderScan({ now = new Date() } = {}) {
  const stageTitles = {
    '3d': ['Registration Deadline Approaching', (name) => `Registration for ${name} closes in 3 days.`],
    '1d': ['Registration Deadline Approaching', (name) => `Registration for ${name} closes tomorrow.`],
    today: ['Last Day to Register', (name) => `Registration for ${name} closes today.`],
  };
  const token = createServiceAdminToken(now);
  const events = await Event.find({
    date: { $gte: startOfTodayUtc(now) },
    registrationDeadline: { $ne: null },
    status: { $ne: 'cancelled' },
  }).select('eventId name date registrationDeadline maxParticipants registrations status');
  const candidates = events.filter((event) => isReminderCandidate(event, now));
  if (candidates.length === 0) return { events: 0, notifications: 0 };

  const studentIds = [...new Set(await getCampusStudentIds(token))];
  let notifications = 0;
  for (const event of candidates) {
    const stage = getReminderStage(event.registrationDeadline, now);
    const recipients = getReminderRecipients(event, studentIds);
    if (recipients.length === 0) continue;
    const [title, message] = stageTitles[stage];
    await sendNotificationsToStudents(token, recipients, {
      title,
      message: message(event.name),
      type: 'event_deadline_reminder',
      relatedEntityType: 'event',
      relatedEntityId: event.eventId,
      idempotencyKey: `event:deadline:${event.eventId}:${stage}`,
    });
    notifications += recipients.length;
  }

  return { events: candidates.length, notifications };
}

function startDeadlineReminderJob({ intervalMs = 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDeadlineReminderScan();
      if (result.events > 0) console.info(`Processed event deadline reminders for ${result.events} event(s) and ${result.notifications} student delivery(s).`);
    } catch (error) {
      console.warn('Event deadline reminder scan failed:', error.message);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { getReminderStage, getReminderRecipients, isReminderCandidate, runDeadlineReminderScan, startDeadlineReminderJob };
