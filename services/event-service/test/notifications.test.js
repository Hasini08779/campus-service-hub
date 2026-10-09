const assert = require('node:assert/strict');
const test = require('node:test');
const { notifyCampusStudents } = require('../utils/notifications');

test('campus event notifications target each saved student profile once', async () => {
  const originalFetch = global.fetch;
  const originalStudentUrl = process.env.STUDENT_SERVICE_URL;
  const originalNotificationUrl = process.env.NOTIFICATION_SERVICE_URL;
  const calls = [];
  process.env.STUDENT_SERVICE_URL = 'http://students.test';
  process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test';

  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname === 'students.test') {
      const page = Number(url.searchParams.get('page'));
      return {
        ok: true,
        json: async () => page === 1
          ? { students: [{ studentId: 'stu001' }], pagination: { pages: 2 } }
          : { students: [{ studentId: 'STU002' }, { studentId: 'STU001' }], pagination: { pages: 2 } },
      };
    }
    return { ok: true };
  };

  try {
    await notifyCampusStudents('signed-admin-token', {
      title: 'New Event Added',
      message: 'A campus event was added.',
      type: 'event_update',
      relatedEntityType: 'event',
      relatedEntityId: 'EVT-TEST',
      idempotencyKey: 'event:new:EVT-TEST',
    });

    const studentRequests = calls.filter(({ url }) => url.hostname === 'students.test');
    const notificationRequests = calls.filter(({ url }) => url.hostname === 'notifications.test');
    assert.equal(studentRequests.length, 2);
    assert.ok(studentRequests.every(({ options }) => options.headers.authorization === 'Bearer signed-admin-token'));
    assert.equal(notificationRequests.length, 1);
    assert.equal(notificationRequests[0].url.pathname, '/api/notifications/bulk');
    assert.deepEqual(JSON.parse(notificationRequests[0].options.body), {
      title: 'New Event Added',
      message: 'A campus event was added.',
      type: 'event_update',
      relatedEntityType: 'event',
      relatedEntityId: 'EVT-TEST',
      idempotencyKey: 'event:new:EVT-TEST',
      userIds: ['STU001', 'STU002'],
    });
  } finally {
    global.fetch = originalFetch;
    if (originalStudentUrl === undefined) delete process.env.STUDENT_SERVICE_URL;
    else process.env.STUDENT_SERVICE_URL = originalStudentUrl;
    if (originalNotificationUrl === undefined) delete process.env.NOTIFICATION_SERVICE_URL;
    else process.env.NOTIFICATION_SERVICE_URL = originalNotificationUrl;
  }
});
