const assert = require('node:assert/strict');
const test = require('node:test');
const { DAY_MS, calculateComplaintStats, complaintAgeState } = require('../utils/complaint-metrics');

const now = new Date('2026-10-02T12:00:00.000Z').getTime();

test('complaint age uses current status transition timestamps and defined attention thresholds', () => {
  const pending = {
    status: 'Pending',
    createdDate: new Date(now - 3 * DAY_MS),
    statusHistory: [{ status: 'Pending', changedAt: new Date(now - 3 * DAY_MS) }],
  };
  const inProgress = {
    status: 'In Progress',
    createdDate: new Date(now - 10 * DAY_MS),
    statusHistory: [
      { status: 'Pending', changedAt: new Date(now - 10 * DAY_MS) },
      { status: 'In Progress', changedAt: new Date(now - DAY_MS) },
    ],
  };

  assert.deepEqual(complaintAgeState(pending, now), {
    since: new Date(now - 3 * DAY_MS),
    elapsedMs: 3 * DAY_MS,
    needsAttention: true,
    overdue: true,
  });
  assert.equal(complaintAgeState(inProgress, now).overdue, false);
  assert.equal(complaintAgeState({ status: 'In Progress', createdDate: new Date(now - 20 * DAY_MS) }, now), null);
});

test('complaint overview returns only real status counts and overdue count', () => {
  const stats = calculateComplaintStats([
    {
      status: 'Resolved',
      createdDate: new Date(now - 4 * DAY_MS),
      resolvedAt: new Date(now - 2 * DAY_MS),
      statusHistory: [
        { status: 'Pending', changedAt: new Date(now - 4 * DAY_MS) },
          { status: 'Resolved', changedAt: new Date(now - 2 * DAY_MS) },
      ],
    },
    {
      status: 'Pending',
      createdDate: new Date(now - 3 * DAY_MS),
      statusHistory: [{ status: 'Pending', changedAt: new Date(now - 3 * DAY_MS) }],
    },
    {
      status: 'In Progress',
      createdDate: new Date(now - 10 * DAY_MS),
      statusHistory: [
        { status: 'Pending', changedAt: new Date(now - 10 * DAY_MS) },
        { status: 'In Progress', changedAt: new Date(now - DAY_MS) },
      ],
    },
    { status: 'Resolved', createdDate: new Date(now - DAY_MS), statusHistory: [] },
  ], now);

  assert.deepEqual(stats, {
    total: 4,
    pending: 1,
    inProgress: 1,
    resolved: 2,
    overdue: 1,
  });
});
