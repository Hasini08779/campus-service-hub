const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const test = require('node:test');
const Notification = require('../models/Notification');
const notificationRoutes = require('../routes/notifications');

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createAdminToken(secret) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'campus-service-hub-auth',
    sub: 'ADMIN-ACCOUNT-1',
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('signed complaint submission and reopen alerts are deduplicated and visible to authenticated admins', async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalFindOneAndUpdate = Notification.findOneAndUpdate;
  const originalFind = Notification.find;
  const originalCountDocuments = Notification.countDocuments;
  const notifications = new Map();
  process.env.JWT_SECRET = 'notification-internal-test-secret';
  Notification.findOneAndUpdate = async (_filter, update) => {
    const insert = update.$setOnInsert;
    const key = `${insert.userId}:${insert.idempotencyKey}`;
    if (!notifications.has(key)) notifications.set(key, insert);
    return notifications.get(key);
  };
  Notification.find = (filter) => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() {
      const globalAdminAudience = filter.$or.some((condition) => condition.audienceRole === 'admin');
      return Promise.resolve(globalAdminAudience ? [...notifications.values()] : []);
    },
  });
  Notification.countDocuments = async (filter) => {
    const globalAdminAudience = filter.$or?.some((condition) => condition.audienceRole === 'admin');
    return globalAdminAudience ? [...notifications.values()].filter((item) => !item.read).length : 0;
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
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/notifications`;
    const body = JSON.stringify({
      title: 'Complaint Reopened',
      message: 'A student reopened a complaint.',
      type: 'complaint_reopened',
      relatedEntityType: 'complaint',
      relatedEntityId: 'CMP-123',
      idempotencyKey: 'complaint:reopened:CMP-123:12345',
    });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', process.env.JWT_SECRET).update(`${timestamp}.${body}`).digest('hex');
    const headers = {
      'content-type': 'application/json',
      'x-service-timestamp': timestamp,
      'x-service-signature': signature,
    };

    const first = await fetch(`${baseUrl}/internal/admin`, { method: 'POST', headers, body });
    const second = await fetch(`${baseUrl}/internal/admin`, { method: 'POST', headers, body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstNotification = (await first.json()).notification;
    const secondNotification = (await second.json()).notification;
    assert.equal(notifications.size, 1);
    assert.equal(firstNotification.notificationId, secondNotification.notificationId);
    assert.equal(firstNotification.audienceRole, 'admin');

    const submittedBody = JSON.stringify({
      title: 'New Complaint Submitted',
      message: 'A new complaint "Projector issue" has been submitted.',
      type: 'complaint_submitted',
      relatedEntityType: 'complaint',
      relatedEntityId: 'CMP-456',
      idempotencyKey: 'complaint:admin-submitted:CMP-456',
    });
    const submittedTimestamp = String(Date.now());
    const submittedSignature = createHmac('sha256', process.env.JWT_SECRET)
      .update(`${submittedTimestamp}.${submittedBody}`)
      .digest('hex');
    const submittedResponse = await fetch(`${baseUrl}/internal/admin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-timestamp': submittedTimestamp,
        'x-service-signature': submittedSignature,
      },
      body: submittedBody,
    });
    assert.equal(submittedResponse.status, 201);
    assert.equal(notifications.size, 2);

    const adminResponse = await fetch(`${baseUrl}?page=1&limit=100`, {
      headers: { authorization: `Bearer ${createAdminToken(process.env.JWT_SECRET)}` },
    });
    assert.equal(adminResponse.status, 200);
    const adminBody = await adminResponse.json();
    assert.equal(adminBody.notifications.length, 2);
    assert.deepEqual(new Set(adminBody.notifications.map((item) => item.type)), new Set(['complaint_reopened', 'complaint_submitted']));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Notification.findOneAndUpdate = originalFindOneAndUpdate;
    Notification.find = originalFind;
    Notification.countDocuments = originalCountDocuments;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
