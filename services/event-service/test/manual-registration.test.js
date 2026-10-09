const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const test = require('node:test');
const Event = require('../models/Event');
const eventRoutes = require('../routes/events');

function createToken(role = 'student') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'campus-service-hub-auth',
    sub: role === 'admin' ? 'admin-account-123' : 'account-123',
    role,
    studentId: 'STU001',
    name: 'Test Student',
    email: 'student@example.edu',
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const signature = createHmac('sha256', process.env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('registration starts Pending and Admin decisions notify students without changing capacity', async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalNotificationUrl = process.env.NOTIFICATION_SERVICE_URL;
  const originalFetch = global.fetch;
  const originalFindOneAndUpdate = Event.findOneAndUpdate;
  const originalFindOne = Event.findOne;
  let event;
  const notifications = [];
  process.env.JWT_SECRET = 'event-registration-test-secret';
  process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test';
  global.fetch = async (url, options) => {
    if (new URL(String(url)).hostname === 'notifications.test') {
      notifications.push({ url: String(url), options });
      return { ok: true };
    }
    return originalFetch(url, options);
  };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  event = {
    eventId: 'EVT-123', name: 'Campus Workshop', status: 'scheduled', date: today,
    registrationDeadline: null, maxParticipants: 2, registrations: [],
    toObject() { return { ...this, registrations: this.registrations }; },
  };
  Event.findOneAndUpdate = async (filter, update) => {
    if (update.$set?.['registrations.$.status']) {
      event.registrations[0].status = update.$set['registrations.$.status'];
      return event;
    }
    const duplicate = event.registrations.some((registration) => registration.studentId === filter['registrations.studentId']?.$ne);
    const atCapacity = event.registrations.length >= event.maxParticipants;
    if (duplicate || atCapacity) return null;
    const registration = { ...update.$push.registrations, registeredAt: new Date() };
    event.registrations.push(registration);
    return event;
  };
  Event.findOne = async () => event;

  const app = express();
  app.use(express.json());
  app.use('/api/events', eventRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const url = `http://127.0.0.1:${server.address().port}/api/events/EVT-123/register`;
    const token = createToken();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const missingDetails = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
    assert.equal(missingDetails.status, 400);
    assert.equal(event.registrations.length, 0);

    const invalidEmail = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ participants: [{
        name: 'Entered Attendee', email: 'not-an-email', phone: '555-0100',
        department: 'Computer Science', semester: 4,
      }] }),
    });
    assert.equal(invalidEmail.status, 400);
    assert.equal(event.registrations.length, 0);

    const registrationDetails = { participants: [{
      name: 'Entered Attendee', email: 'ATTENDEE@example.edu', phone: '555-0100',
      department: 'Computer Science', semester: 4,
    }] };
    const registered = await fetch(url, { method: 'POST', headers, body: JSON.stringify(registrationDetails) });
    assert.equal(registered.status, 201);
    const registeredBody = await registered.json();
    assert.equal(registeredBody.event.registrationCount, 1);
    assert.equal(registeredBody.registration.studentId, 'STU001');
    assert.equal(registeredBody.registration.status, 'Pending');
    assert.equal(registeredBody.registration.participants.length, 1);
    assert.equal(registeredBody.registration.department, 'Computer Science');
    assert.equal(registeredBody.registration.semester, 4);
    assert.equal(notifications.length, 2);
    const notificationPath = (notification) => new URL(notification.url).pathname;
    const pendingStudentNotification = notifications.find((notification) => notificationPath(notification) === '/api/notifications');
    const pendingAdminNotification = notifications.find((notification) => notificationPath(notification) === '/api/notifications/internal/event-registration');
    assert.equal(JSON.parse(pendingStudentNotification.options.body).registrationStatus, 'Pending');
    assert.equal(JSON.parse(pendingAdminNotification.options.body).type, 'event_registration_pending');
    assert.deepEqual(JSON.parse(pendingAdminNotification.options.body).registrationParticipants, [
      { ...registrationDetails.participants[0], email: registrationDetails.participants[0].email.toLowerCase() },
    ]);

    const duplicate = await fetch(url, { method: 'POST', headers, body: JSON.stringify(registrationDetails) });
    assert.equal(duplicate.status, 409);
    assert.equal(event.registrations.length, 1);
    assert.equal(notifications.length, 2);

    const decisionUrl = `${url.replace('/register', '')}/registrations/STU001/status`;
    const accepted = await fetch(decisionUrl, {
      method: 'PATCH',
      headers: { ...headers, authorization: `Bearer ${createToken('admin')}` },
      body: JSON.stringify({ status: 'Accepted' }),
    });
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.registration.status, 'Accepted');
    assert.equal(event.registrations.length, 1, 'approval must not alter capacity usage');
    assert.equal(notifications.length, 4);
    const decisionStudentNotification = notifications.find((notification) => notificationPath(notification) === '/api/notifications' && JSON.parse(notification.options.body).registrationStatus === 'Accepted');
    assert.equal(JSON.parse(decisionStudentNotification.options.body).title, 'Registration Accepted');
    const updatedAdminNotification = notifications.find((notification) => notificationPath(notification) === '/api/notifications/internal/event-registration' && JSON.parse(notification.options.body).action === 'update-status');
    assert.equal(JSON.parse(updatedAdminNotification.options.body).registrationStatus, 'Accepted');

    event.eventType = 'group';
    event.maxTeamSize = 2;
    event.registrations = [];
    const participant = (name, email) => ({
      name, email, phone: '555-0100', department: 'Computer Science', semester: 4,
    });
    const tooSmallTeam = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ teamName: 'Test Team', participants: [participant('Test Student', 'student@example.edu')] }),
    });
    assert.equal(tooSmallTeam.status, 400);

    const tooLargeTeam = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ teamName: 'Test Team', participants: [
        participant('Group Lead', 'lead@example.edu'),
        participant('Second Student', 'second@example.edu'),
        participant('Third Student', 'third@example.edu'),
      ] }),
    });
    assert.equal(tooLargeTeam.status, 400);

    const missingTeamName = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ participants: [
        participant('Group Lead', 'lead@example.edu'),
        participant('Second Student', 'second@example.edu'),
      ] }),
    });
    assert.equal(missingTeamName.status, 400);

    const groupRegistration = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ teamName: 'Robotics Team', participants: [
        participant('Group Lead', 'lead@example.edu'),
        participant('Second Student', 'second@example.edu'),
      ] }),
    });
    assert.equal(groupRegistration.status, 201);
    const groupBody = await groupRegistration.json();
    assert.equal(groupBody.event.registrationCount, 1);
    assert.equal(groupBody.registration.studentId, 'STU001');
    assert.equal(groupBody.registration.teamName, 'Robotics Team');
    assert.equal(groupBody.registration.participants.length, 2);
    assert.equal(groupBody.registration.name, 'Group Lead');
    assert.equal(groupBody.registration.participants[1].name, 'Second Student');
    assert.equal(groupBody.registration.phone, '555-0100');
    assert.equal(notifications.length, 6);

    const rejected = await fetch(decisionUrl, {
      method: 'PATCH',
      headers: { ...headers, authorization: `Bearer ${createToken('admin')}` },
      body: JSON.stringify({ status: 'Rejected' }),
    });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).registration.status, 'Rejected');
    assert.equal(event.registrations.length, 1, 'rejection must not alter capacity usage');
    const rejectionNotification = notifications.find((notification) => notificationPath(notification) === '/api/notifications' && JSON.parse(notification.options.body).registrationStatus === 'Rejected');
    assert.equal(JSON.parse(rejectionNotification.options.body).title, 'Registration Rejected');
    assert.equal(notifications.length, 8);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    Event.findOneAndUpdate = originalFindOneAndUpdate;
    Event.findOne = originalFindOne;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalNotificationUrl === undefined) delete process.env.NOTIFICATION_SERVICE_URL;
    else process.env.NOTIFICATION_SERVICE_URL = originalNotificationUrl;
  }
});