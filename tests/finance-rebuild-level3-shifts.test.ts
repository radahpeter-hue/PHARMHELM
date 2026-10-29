import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredEodShifts, eodIdentity } from '../src/utils/eodShifts';
const shifts = { dayShift: { enabled: true, startTime: '08:00', endTime: '16:00' }, eveningShift: { enabled: true, startTime: '16:00', endTime: '22:00' }, nightShift: { enabled: false, startTime: '22:00', endTime: '08:00' } };
test('024 only configured enabled shifts are offered and immutable field keys persist', () => {
  assert.deepEqual(configuredEodShifts({ shifts }).map(s => s.id), ['dayShift', 'eveningShift']);
  assert.equal(configuredEodShifts({ shifts })[0].name, 'Day Shift');
  assert.deepEqual(configuredEodShifts(null), []);
});
test('024 identity separates shifts/dates/branches/tenants without delimiter collisions', () => {
  const keys = [eodIdentity('mp','masaka','2026-10-28','dayShift'),eodIdentity('mp','masaka','2026-10-28','eveningShift'),eodIdentity('mp','masaka','2026-10-27','dayShift'),eodIdentity('mp','other','2026-10-28','dayShift'),eodIdentity('other','masaka','2026-10-28','dayShift')];
  assert.equal(new Set(keys).size, 5);
  assert.throws(() => eodIdentity('mp~masaka','x','2026-10-28','dayShift'));
  assert.throws(() => eodIdentity('mp','','2026-10-28','dayShift'));
});

test('025 saved Settings changes affect future choices, snapshots retain earlier hours', () => {
  const branch = { shifts: structuredClone(shifts) };
  const snapshot = configuredEodShifts(branch)[0];
  branch.shifts.dayShift.startTime = '09:00';
  branch.shifts.eveningShift.enabled = false;
  assert.equal(configuredEodShifts(branch).length, 1);
  assert.equal(configuredEodShifts(branch)[0].startTime, '09:00');
  assert.equal(snapshot.startTime, '08:00');
  branch.shifts.nightShift.enabled = true;
  assert.deepEqual(configuredEodShifts(branch).map(s => s.id), ['dayShift', 'nightShift']);
});
