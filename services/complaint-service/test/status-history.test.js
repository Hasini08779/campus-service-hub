const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const test = require('node:test');
const Complaint = require('../models/Complaint');
const complaintRoutes = require('../routes/complaints');

function createToken(role, identity) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'campus-service-hub-auth',
    sub: identity,
    role,
    ...(role === 'student' ? { studentId: identity } : {}),
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const signature = createHmac('sha256', process.env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('submission and admin status changes expose server-timestamped complaint history to the student', async () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalNotificationUrl = process.env.NOTIFICATION_SERVICE_URL;
  const originalFetch = global.fetch;
  const originalCreate = Complaint.create;
  const originalFindOne = Complaint.findOne;
  const originalFindOneAndUpdate = Complaint.findOneAndUpdate;
  const originalFind = Complaint.find;
  const originalCountDocuments = Complaint.countDocuments;
  let storedComplaint;
  const notificationCalls = [];
  process.env.JWT_SECRET = 'complaint-history-test-secret';
  process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test';
  global.fetch = async (input, options) => {
    if (new URL(String(input)).hostname === 'notifications.test') {
      notificationCalls.push({ url: String(input), options });
      return { ok: true };
    }
    return originalFetch(input, options);
  };
  Complaint.create = async (details) => {
    storedComplaint = { ...details, updatedAt: details.createdDate, save: async function save() { return this; } };
    return storedComplaint;
  };
  Complaint.findOne = async () => storedComplaint;
  Complaint.findOneAndUpdate = async (filter, update) => {
    if (filter.status && storedComplaint.status !== filter.status) return null;
    if (filter.resolutionCycle?.$in && !filter.resolutionCycle.$in.includes(storedComplaint.resolutionCycle ?? null)) return null;
    if (filter.resolvedAt?.$in && !filter.resolvedAt.$in.some((value) => String(value) === String(storedComplaint.resolvedAt ?? null))) return null;
    if (filter.resolutionFeedbackHistory?.$not?.$elemMatch?.cycle) {
      const cycle = filter.resolutionFeedbackHistory.$not.$elemMatch.cycle;
      if ((storedComplaint.resolutionFeedbackHistory || []).some((item) => item.cycle === cycle)) return null;
    }
    if (filter.$or?.length) {
      const allowed = filter.$or.some((condition) => (
        condition['resolutionFeedback.submittedAt']?.$exists === false && !storedComplaint.resolutionFeedback?.submittedAt
      ) || (
        condition['resolutionFeedback.cycle']?.$ne !== undefined && condition['resolutionFeedback.cycle'].$ne !== (storedComplaint.resolutionFeedback?.cycle ?? null)
      ));
      if (!allowed) return null;
    }
    storedComplaint = { ...storedComplaint, ...(update.$set || {}) };
    for (const key of Object.keys(update.$unset || {})) delete storedComplaint[key];
    if (update.$push?.statusHistory) storedComplaint.statusHistory = [...storedComplaint.statusHistory, update.$push.statusHistory];
    if (update.$push?.resolutionFeedbackHistory) storedComplaint.resolutionFeedbackHistory = [...(storedComplaint.resolutionFeedbackHistory || []), update.$push.resolutionFeedbackHistory];
    if (update.$push?.statusHistory?.changedAt) storedComplaint.updatedAt = update.$push.statusHistory.changedAt;
    return storedComplaint;
  };
  Complaint.find = () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return Promise.resolve([storedComplaint]); },
  });
  Complaint.countDocuments = async () => 1;

  const app = express();
  app.use(express.json());
  app.use('/api/complaints', complaintRoutes);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/complaints`;
    const studentToken = createToken('student', 'STU001');
    const adminToken = createToken('admin', 'ADMIN001');
    const submitted = await fetch(baseUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${studentToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'Facilities', subject: 'Projector issue', description: 'The classroom projector is not working.' }),
    });

    assert.equal(submitted.status, 201);
    const submittedBody = await submitted.json();
    const submittedAt = submittedBody.complaint.createdDate;
    assert.deepEqual(submittedBody.complaint.statusHistory, [{ status: 'Pending', changedAt: submittedAt }]);
    const submittedAdminNotice = notificationCalls.map(({ url, options }) => ({ url, body: JSON.parse(options.body) }))
      .find(({ url, body }) => url.endsWith('/internal/admin') && body.type === 'complaint_submitted');
    assert.ok(submittedAdminNotice);
    assert.equal(submittedAdminNotice.body.title, 'New Complaint Submitted');
    assert.equal(submittedAdminNotice.body.relatedEntityId, submittedBody.complaint.complaintId);

    for (const status of ['In Progress', 'Resolved']) {
      const requestStartedAt = Date.now();
      const response = await fetch(`${baseUrl}/${storedComplaint.complaintId}/status`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...(status === 'Resolved' ? { resolutionNote: 'Replaced the projector cable.' } : {}) }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      const historyEntry = body.complaint.statusHistory.at(-1);
      assert.equal(historyEntry.status, status);
      assert.ok(new Date(historyEntry.changedAt).getTime() >= requestStartedAt);
      if (status === 'Resolved') {
        assert.equal(body.complaint.resolutionNote, 'Replaced the projector cable.');
        assert.equal(new Date(body.complaint.resolvedAt).getTime(), new Date(historyEntry.changedAt).getTime());
      }
    }

    const acknowledgement = await fetch(`${baseUrl}/${storedComplaint.complaintId}/acknowledge-resolution`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.equal(acknowledgement.status, 200);
    assert.ok((await acknowledgement.json()).complaint.resolutionConfirmedAt);

    const feedbackResponse = await fetch(`${baseUrl}/${storedComplaint.complaintId}/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${studentToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 5, comment: 'The repair solved the problem.' }),
    });
    assert.equal(feedbackResponse.status, 201);
    const savedFeedback = (await feedbackResponse.json()).complaint.resolutionFeedback;
    assert.equal(savedFeedback.rating, 5);
    assert.equal(savedFeedback.comment, 'The repair solved the problem.');
    const feedbackAdminNotice = notificationCalls.map(({ url, options }) => ({ url, body: JSON.parse(options.body) }))
      .find(({ url, body }) => url.endsWith('/internal/admin') && body.type === 'complaint_feedback');
    assert.ok(feedbackAdminNotice);
    assert.equal(feedbackAdminNotice.body.title, 'New Complaint Feedback');
    assert.equal(feedbackAdminNotice.body.relatedEntityId, storedComplaint.complaintId);
    assert.match(feedbackAdminNotice.body.message, /Projector issue/);
    assert.match(feedbackAdminNotice.body.message, /5\/5/);
    const duplicateFeedback = await fetch(`${baseUrl}/${storedComplaint.complaintId}/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${studentToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 2, comment: 'Replacement feedback must not overwrite the original.' }),
    });
    assert.equal(duplicateFeedback.status, 409);
    assert.equal(storedComplaint.resolutionFeedback.rating, 5);

    const reopenStartedAt = Date.now();
    const reopenResponse = await fetch(`${baseUrl}/${storedComplaint.complaintId}/reopen`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.equal(reopenResponse.status, 200);
    const reopened = (await reopenResponse.json()).complaint;
    const reopenEntry = reopened.statusHistory.at(-1);
    assert.equal(reopened.status, 'In Progress');
    assert.equal(reopened.resolvedAt, undefined);
    assert.equal(reopenEntry.event, 'reopened');
    assert.ok(new Date(reopenEntry.changedAt).getTime() >= reopenStartedAt);
    const reopenNotification = notificationCalls.find(({ url, options }) => url.endsWith('/internal/admin') && JSON.parse(options.body).type === 'complaint_reopened');
    assert.ok(reopenNotification);
    const reopenNotice = JSON.parse(reopenNotification.options.body);
    assert.equal(reopenNotice.title, 'Complaint Reopened');
    assert.equal(reopenNotice.message, "The student has reopened 'Projector issue' because the issue was not resolved.");
    assert.equal(reopenNotice.type, 'complaint_reopened');
    assert.equal(reopenNotice.relatedEntityId, storedComplaint.complaintId);
    const repeatedReopen = await fetch(`${baseUrl}/${storedComplaint.complaintId}/reopen`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.equal(repeatedReopen.status, 409);
    assert.equal(notificationCalls.filter(({ url, options }) => url.endsWith('/internal/admin') && JSON.parse(options.body).type === 'complaint_reopened').length, 1);

    const secondResolveStartedAt = Date.now();
    const secondResolve = await fetch(`${baseUrl}/${storedComplaint.complaintId}/status`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'Resolved', resolutionNote: 'Replaced the projector.' }),
    });
    assert.equal(secondResolve.status, 200);
    const secondResolvedComplaint = (await secondResolve.json()).complaint;
    assert.equal(secondResolvedComplaint.status, 'Resolved');
    assert.equal(secondResolvedComplaint.resolutionCycle, 2);
    assert.ok(new Date(secondResolvedComplaint.resolvedAt).getTime() >= secondResolveStartedAt);
    const resolutionNotifications = notificationCalls.filter(({ url, options }) => url.endsWith('/api/notifications') && JSON.parse(options.body).title === 'Complaint Resolved');
    assert.equal(resolutionNotifications.length, 2);
    assert.notEqual(JSON.parse(resolutionNotifications[0].options.body).idempotencyKey, JSON.parse(resolutionNotifications[1].options.body).idempotencyKey);

    const secondFeedback = await fetch(`${baseUrl}/${storedComplaint.complaintId}/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${studentToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 4, comment: 'Resolved after the second repair.' }),
    });
    assert.equal(secondFeedback.status, 201);
    const secondFeedbackComplaint = (await secondFeedback.json()).complaint;
    assert.equal(secondFeedbackComplaint.resolutionFeedback.cycle, 2);
    assert.equal(secondFeedbackComplaint.resolutionFeedback.rating, 4);
    assert.deepEqual(secondFeedbackComplaint.resolutionFeedbackHistory.map((item) => item.rating), [5, 4]);
    assert.deepEqual(secondFeedbackComplaint.resolutionFeedbackHistory.map((item) => item.cycle), [1, 2]);

    const studentResponse = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${studentToken}` },
    });
    assert.equal(studentResponse.status, 200);
    const studentBody = await studentResponse.json();
    assert.deepEqual(studentBody.complaints[0].statusHistory.map((entry) => entry.status), ['Pending', 'In Progress', 'Resolved', 'In Progress', 'Resolved']);
    assert.ok(studentBody.complaints[0].statusHistory.every((entry) => !Number.isNaN(new Date(entry.changedAt).getTime())));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    Complaint.create = originalCreate;
    Complaint.findOne = originalFindOne;
    Complaint.findOneAndUpdate = originalFindOneAndUpdate;
    Complaint.find = originalFind;
    Complaint.countDocuments = originalCountDocuments;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalNotificationUrl === undefined) delete process.env.NOTIFICATION_SERVICE_URL;
    else process.env.NOTIFICATION_SERVICE_URL = originalNotificationUrl;
  }
});
