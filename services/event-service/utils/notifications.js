const { createHmac } = require('node:crypto');

async function sendNotification(token, notification) {
  const serviceUrl = process.env.NOTIFICATION_SERVICE_URL?.replace(/\/$/, '');
  if (!serviceUrl) {
    return;
  }

  try {
    const response = await fetch(`${serviceUrl}/api/notifications`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      console.warn(`Notification service returned status ${response.status}.`);
    }
  } catch (error) {
    console.warn('Could not send event notification:', error.message);
  }
}

async function sendAdminEventRegistrationNotification(token, notification) {
  const serviceUrl = process.env.NOTIFICATION_SERVICE_URL?.replace(/\/$/, '');
  if (!serviceUrl) return;

  const timestamp = String(Date.now());
  const signature = createHmac('sha256', process.env.JWT_SECRET)
    .update(`${timestamp}.${JSON.stringify(notification)}`)
    .digest('hex');
  try {
    const response = await fetch(`${serviceUrl}/api/notifications/internal/event-registration`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-timestamp': timestamp,
        'x-service-signature': signature,
      },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) console.warn(`Notification service rejected event registration alert with status ${response.status}.`);
  } catch (error) {
    console.warn('Could not send Admin event registration notification:', error.message);
  }
}

async function sendNotificationsToStudents(token, userIds, notification) {
  const serviceUrl = process.env.NOTIFICATION_SERVICE_URL?.replace(/\/$/, '');
  if (!serviceUrl || userIds.length === 0) return;

  try {
    const batches = Array.from({ length: Math.ceil(userIds.length / 500) }, (_, index) => userIds.slice(index * 500, (index + 1) * 500));
    const results = await Promise.all(batches.map((userIdsBatch) => fetch(`${serviceUrl}/api/notifications/bulk`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...notification, userIds: userIdsBatch }),
      signal: AbortSignal.timeout(3000),
    })));

    const failed = results.filter((response) => !response.ok);
    if (failed.length > 0) console.warn(`Notification Service rejected ${failed.length} event notification batch(es).`);
  } catch (error) {
    console.warn('Could not send event notifications:', error.message);
  }
}

async function getCampusStudentIds(token) {
  const serviceUrl = (process.env.STUDENT_SERVICE_URL || 'http://localhost:5002').replace(/\/$/, '');
  const fetchPage = async (page) => {
    const response = await fetch(`${serviceUrl}/api/students?page=${page}&limit=100`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Student Service returned status ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result.students)) throw new Error('Student Service returned an unexpected response.');
    return result;
  };

  const firstPage = await fetchPage(1);
  const pageCount = Math.max(1, Number(firstPage.pagination?.pages) || 1);
  const remainingPages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...firstPage.students, ...remainingPages.flatMap((page) => page.students)]
    .map((student) => typeof student.studentId === 'string' ? student.studentId.trim().toUpperCase() : '')
    .filter(Boolean);
}

async function notifyCampusStudents(token, notification) {
  try {
    const userIds = [...new Set(await getCampusStudentIds(token))];
    await sendNotificationsToStudents(token, userIds, notification);
  } catch (error) {
    console.warn('Could not determine campus event recipients:', error.message);
  }
}

module.exports = { sendNotification, sendAdminEventRegistrationNotification, sendNotificationsToStudents, getCampusStudentIds, notifyCampusStudents };
