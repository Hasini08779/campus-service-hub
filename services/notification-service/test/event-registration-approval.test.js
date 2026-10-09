const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const test = require('node:test');
const Notification = require('../models/Notification');
const notificationRoutes = require('../routes/notifications');

function signRequest(secret, body) {
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
  };
}

test('signed Event Service registration alerts persist details and decision status for Admins', async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalFindOneAndUpdate = Notification.findOneAndUpdate;
  const records = new Map();
  process.env.JWT_SECRET = 'event-registration-notification-test-secret';
  Notification.findOneAndUpdate = (filter, update) => {
    const key = `${filter.userId}:${filter.idempotencyKey}`;
    const existing = records.get(key);
    if (update.$setOnInsert) {
      if (!existing) records.set(key, { notificationId: `NTF-${records.size + 1}`, ...update.$setOnInsert });
    } else if (existing) {
      Object.assign(existing, update.$set);
    }
    const result = records.get(key) || null;
    return {
      select() { return this; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const url = `http://127.0.0.1:${server.address().port}/api/notifications/internal/event-registration`;
    const details = [{
      name: 'Attendee One', email: 'one@example.edu', phone: '555-0100',
      department: 'Computer Science', semester: 4,
    }];
    const body = {
      action: 'create', title: 'Event Registration Pending',
      message: 'One participant registered for Campus Workshop.',
      type: 'event_registration_pending', relatedEntityType: 'event', relatedEntityId: 'EVT-123',
      registrationStudentId: 'STU001', registrationParticipants: details,
      registrationStatus: 'Pending', idempotencyKey: 'event:registration-pending:EVT-123:STU001:12345',
    };
    const first = await fetch(url, { method: 'POST', headers: signRequest(process.env.JWT_SECRET, body), body: JSON.stringify(body) });
    const replay = await fetch(url, { method: 'POST', headers: signRequest(process.env.JWT_SECRET, body), body: JSON.stringify(body) });
    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    const firstNotification = (await first.json()).notification;
    const replayNotification = (await replay.json()).notification;
    assert.equal(records.size, 1);
    assert.equal(firstNotification.notificationId, replayNotification.notificationId);
    assert.equal(firstNotification.audienceRole, 'admin');
    assert.equal(firstNotification.registrationStatus, 'Pending');
    assert.deepEqual(firstNotification.registrationParticipants, details);

    const decision = {
      action: 'update-status', relatedEntityId: 'EVT-123', registrationStudentId: 'STU001',
      registrationStatus: 'Accepted', idempotencyKey: body.idempotencyKey,
    };
    const updated = await fetch(url, { method: 'POST', headers: signRequest(process.env.JWT_SECRET, decision), body: JSON.stringify(decision) });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).notification.registrationStatus, 'Accepted');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Notification.findOneAndUpdate = originalFindOneAndUpdate;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
