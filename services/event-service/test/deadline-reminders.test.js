const assert = require('node:assert/strict');
const test = require('node:test');
const { getReminderStage, getReminderRecipients, isReminderCandidate } = require('../utils/deadline-reminders');

const now = new Date('2026-10-01T10:00:00.000Z');
const eventWithDeadline = (deadline, overrides = {}) => ({
  eventId: 'EVT-TEST',
  name: 'Test event',
  date: new Date('2026-10-20T00:00:00.000Z'),
  registrationDeadline: new Date(`${deadline}T00:00:00.000Z`),
  maxParticipants: 10,
  registrations: [],
  status: 'scheduled',
  ...overrides,
});

test('deadline reminder stages are stable for three days, tomorrow, and final day', () => {
  assert.equal(getReminderStage(new Date('2026-10-04T00:00:00.000Z'), now), '3d');
  assert.equal(getReminderStage(new Date('2026-10-02T00:00:00.000Z'), now), '1d');
  assert.equal(getReminderStage(new Date('2026-10-01T00:00:00.000Z'), now), 'today');
  assert.equal(getReminderStage(new Date('2026-10-05T00:00:00.000Z'), now), null);
});

test('reminders exclude cancelled, past, and full events', () => {
  assert.equal(isReminderCandidate(eventWithDeadline('2026-10-04'), now), true);
  assert.equal(isReminderCandidate(eventWithDeadline('2026-10-04', { status: 'cancelled' }), now), false);
  assert.equal(isReminderCandidate(eventWithDeadline('2026-10-04', { date: new Date('2026-09-30T00:00:00.000Z') }), now), false);
  assert.equal(isReminderCandidate(eventWithDeadline('2026-10-04', { registrations: Array(10).fill({ studentId: 'S' }) }), now), false);
});

test('reminders exclude already-registered students using normalized student IDs', () => {
  const event = eventWithDeadline('2026-10-04', { registrations: [{ studentId: 'stu001' }] });
  assert.deepEqual(getReminderRecipients(event, ['STU001', 'stu002']), ['stu002']);
});
