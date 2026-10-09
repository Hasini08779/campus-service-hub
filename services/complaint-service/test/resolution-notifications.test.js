const assert = require('node:assert/strict');
const test = require('node:test');
const { buildResolutionNotification, sendNotification } = require('../utils/notifications');

test('resolved complaint notifications use the requested content and stable idempotency key', () => {
  const complaint = {
    complaintId: 'CMP-123',
    studentId: 'STU001',
    subject: 'Broken classroom projector',
    resolvedAt: '2026-10-02T09:20:00.000Z',
  };

  const first = buildResolutionNotification(complaint);
  const repeated = buildResolutionNotification(complaint);

  assert.deepEqual(first, {
    userId: 'STU001',
    title: 'Complaint Resolved',
    message: 'Your complaint "Broken classroom projector" has been resolved.',
    type: 'complaint_status_change',
    relatedEntityType: 'complaint',
    relatedEntityId: 'CMP-123',
    idempotencyKey: 'complaint:resolved:CMP-123:1790932800000',
  });
  assert.equal(repeated.idempotencyKey, first.idempotencyKey);
  assert.notEqual(buildResolutionNotification({ ...complaint, resolvedAt: '2026-10-03T09:20:00.000Z' }).idempotencyKey, first.idempotencyKey);
});

test('resolution notification delivery sends the idempotency key to Notification Service', async () => {
  const originalFetch = global.fetch;
  const originalServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
  const calls = [];
  process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test';
  global.fetch = async (input, options = {}) => {
    calls.push({ url: String(input), options });
    return { ok: true };
  };

  try {
    const notification = buildResolutionNotification({
      complaintId: 'CMP-123',
      studentId: 'STU001',
      subject: 'Broken classroom projector',
      resolvedAt: '2026-10-02T09:20:00.000Z',
    });
    await sendNotification('admin-token', notification);
    await sendNotification('admin-token', notification);

    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ url }) => url === 'http://notifications.test/api/notifications'));
    assert.ok(calls.every(({ options }) => options.headers.authorization === 'Bearer admin-token'));
    assert.ok(calls.every(({ options }) => JSON.parse(options.body).idempotencyKey === 'complaint:resolved:CMP-123:1790932800000'));
  } finally {
    global.fetch = originalFetch;
    if (originalServiceUrl === undefined) delete process.env.NOTIFICATION_SERVICE_URL;
    else process.env.NOTIFICATION_SERVICE_URL = originalServiceUrl;
  }
});
