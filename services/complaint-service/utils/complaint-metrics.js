const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_THRESHOLDS = { Pending: DAY_MS, 'In Progress': 3 * DAY_MS };
const OVERDUE_THRESHOLDS = { Pending: 2 * DAY_MS, 'In Progress': 5 * DAY_MS };

function currentStatusSince(complaint) {
  const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : [];
  const currentEntry = [...history].reverse().find((entry) => entry.status === complaint.status && entry.changedAt);
  if (currentEntry) return new Date(currentEntry.changedAt);
  if (complaint.status === 'Pending' && complaint.createdDate) return new Date(complaint.createdDate);
  return null;
}

function complaintAgeState(complaint, now = Date.now()) {
  if (!['Pending', 'In Progress'].includes(complaint.status)) return null;
  const since = currentStatusSince(complaint);
  if (!since || Number.isNaN(since.getTime())) return null;
  const elapsedMs = Math.max(0, now - since.getTime());
  return {
    since,
    elapsedMs,
    needsAttention: elapsedMs >= ATTENTION_THRESHOLDS[complaint.status],
    overdue: elapsedMs >= OVERDUE_THRESHOLDS[complaint.status],
  };
}

function calculateComplaintStats(complaints, now = Date.now()) {
  const stats = {
    total: complaints.length,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    overdue: 0,
  };

  for (const complaint of complaints) {
    if (complaint.status === 'Pending') stats.pending += 1;
    if (complaint.status === 'In Progress') stats.inProgress += 1;
    if (complaint.status === 'Resolved') stats.resolved += 1;
    if (complaintAgeState(complaint, now)?.overdue) stats.overdue += 1;
  }

  return stats;
}

module.exports = { DAY_MS, complaintAgeState, currentStatusSince, calculateComplaintStats };