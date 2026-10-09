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
    console.warn('Could not send complaint notification:', error.message);
  }
}

async function notifyAdmin(notification) {
  const serviceUrl = process.env.NOTIFICATION_SERVICE_URL?.replace(/\/$/, '');
  const secret = process.env.JWT_SECRET;
  if (!serviceUrl || !secret) return;

  const payload = {
    ...notification,
    userId: notification.userId || process.env.ADMIN_USER_ID || 'ADMIN',
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  console.log('[DEBUG] complaint-service notifyAdmin payload', { payload, serviceUrl, timestamp });
  try {
    const response = await fetch(`${serviceUrl}/api/notifications/internal/admin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-timestamp': timestamp,
        'x-service-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(2000),
    });
    const responseText = await response.text();
    console.log('[DEBUG] complaint-service notifyAdmin response', { status: response.status, body: responseText });
    if (!response.ok) console.warn(`Notification service returned status ${response.status} for admin complaint notification.`);
  } catch (error) {
    console.warn('Could not send complaint reopen notification to admin:', error.message);
  }
}

function buildResolutionNotification(complaint) {
  const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : [];
  const latestResolution = [...history].reverse().find((entry) => entry.status === 'Resolved' && entry.changedAt);
  const resolvedAt = complaint.resolvedAt || latestResolution?.changedAt;
  const transitionKey = resolvedAt && !Number.isNaN(new Date(resolvedAt).getTime())
    ? `:${new Date(resolvedAt).getTime()}`
    : '';
  return {
    userId: complaint.studentId,
    title: 'Complaint Resolved',
    message: `Your complaint "${complaint.subject}" has been resolved.`,
    type: 'complaint_status_change',
    relatedEntityType: 'complaint',
    relatedEntityId: complaint.complaintId,
    idempotencyKey: `complaint:resolved:${complaint.complaintId}${transitionKey}`,
  };
}

module.exports = { sendNotification, notifyAdmin, buildResolutionNotification };
