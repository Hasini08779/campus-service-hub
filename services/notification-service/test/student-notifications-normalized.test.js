const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const authMiddleware = require('../middleware/auth');
authMiddleware.authenticateToken = (req, _res, next) => {
  req.user = { role: 'student', studentId: 'STUCASE001' };
  return next();
};
const Notification = require('../models/Notification');
const notificationRoutes = require('../routes/notifications');

async function withApp(handler) {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    await handler(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('student notification lookup matches legacy lowercase user IDs', async () => {
  const originalFind = Notification.find;
  const originalCount = Notification.countDocuments;

  try {
    const legacyNotification = {
      notificationId: 'NTF-LEGACY-CASE',
      userId: 'stucase001',
      message: 'Legacy mixed case notification',
      type: 'campus_announcement',
      createdDate: new Date(),
      read: false,
    };

    const appCalls = [];
    Notification.find = function (...args) {
      const filter = args[0];
      appCalls.push(filter);
      if (filter && filter.$or && filter.$or.some((clause) => clause.userId && clause.userId.$regex)) {
        return {
          select() {
            return this;
          },
          sort() {
            return this;
          },
          skip() {
            return this;
          },
          limit() {
            return Promise.resolve([legacyNotification]);
          },
        };
      }
      return {
        select() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return Promise.resolve([]); },
      };
    };
    Notification.countDocuments = function (...args) {
      const filter = args[0];
      appCalls.push(filter);
      if (filter && filter.$or && filter.$or.some((clause) => clause.userId && clause.userId.$regex)) {
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    };

    await withApp(async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications?page=1&limit=20`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.notifications.length, 1);
      assert.equal(body.notifications[0].userId, 'stucase001');
    });

    assert.ok(appCalls.some((filter) => filter && filter.$or && filter.$or.some((clause) => clause.userId && clause.userId.$regex)));
  } finally {
    Notification.find = originalFind;
    Notification.countDocuments = originalCount;
  }
});
