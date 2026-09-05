const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timer, DEFAULTS, dayKey } = require('../src/timer.cjs');
const now = new Date(2026, 8, 5, 12).getTime();

test('start, pause, resume, reset and skip preserve the right duration and count', () => {
  const timer = new Timer();
  timer.toggle(now);
  assert.equal(timer.remaining(now + 5000), 1495000);
  timer.toggle(now + 5000);
  assert.equal(timer.remaining(now + 60000), 1495000);
  timer.toggle(now + 60000);
  assert.equal(timer.remaining(now + 65000), 1490000);
  timer.select('focus');
  assert.equal(timer.remaining(now), 1500000);
  timer.skip();
  assert.equal(timer.mode, 'short');
  assert.equal(timer.history.length, 0);
  assert.equal(timer.cycle, 0);
  timer.skip();
  assert.equal(timer.mode, 'focus');
});

test('four completed focus sessions earn a long break; ticks cannot double count', () => {
  const timer = new Timer();
  for (let i = 0; i < 4; i++) {
    timer.select('focus'); timer.toggle(now);
    const event = timer.tick(now + 1500000);
    assert.equal(event.completed, 'focus');
    assert.equal(timer.mode, i === 3 ? 'long' : 'short');
    assert.equal(timer.tick(now + 1600000), null);
  }
  assert.equal(timer.history.length, 4);
  assert.equal(timer.cycle, 0);
  assert.equal(timer.snapshot(now).today.minutes, 100);
});

test('restart and sleep recovery complete only one elapsed session and start next at wake', () => {
  const original = new Timer();
  original.configure({ autoBreak: true, autoFocus: true });
  original.task = 'Read a chapter'; original.toggle(now);
  const wake = now + 86400000;
  const restored = new Timer(original.serialize(now + 1000), wake);
  assert.equal(restored.tick(wake).next, 'short');
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0].at, now + 1500000);
  assert.equal(restored.history[0].task, 'Read a chapter');
  assert.equal(restored.remaining(wake), 300000);
  assert.equal(restored.snapshot(wake).today.count, 0);
  assert.equal(restored.tick(wake + 300000).next, 'focus');
  assert.equal(restored.remaining(wake + 300000), 1500000);
});

test('duration changes do not replace a running or paused session', () => {
  const timer = new Timer();
  timer.configure({ focus: 30 }); assert.equal(timer.totalMs, 1800000);
  timer.toggle(now); timer.configure({ focus: 45 }); assert.equal(timer.totalMs, 1800000);
  timer.toggle(now + 1000); timer.configure({ focus: 60 }); assert.equal(timer.remainingMs, 1799000);
  const restored = new Timer(timer.serialize(now), now);
  assert.equal(restored.remainingMs, 1799000);
  assert.equal(restored.deadline, null);
  restored.select('focus'); assert.equal(restored.totalMs, 3600000);
});

test('malformed persisted data and invalid preferences get safe defaults', () => {
  const timer = new Timer({ settings: { focus: -3, short: '5', rounds: 0, goal: 500, sound: 'true', theme: 'evil' },
    deadline: Infinity, totalMs: -1, remainingMs: NaN, mode: '__proto__', cycle: 3.5,
    history: [null, { at: 'x' }, { at: now, minutes: -2, task: 'x' }] }, now);
  assert.deepEqual(timer.settings, DEFAULTS);
  assert.equal(timer.mode, 'focus'); assert.equal(timer.deadline, null); assert.equal(timer.cycle, 0);
  assert.equal(timer.totalMs, 1500000); assert.deepEqual(timer.history, []);
  assert.doesNotThrow(() => new Timer(null));
});

test('today uses local dates and credits completion time across midnight', () => {
  const start = new Date(2026, 8, 5, 23, 50).getTime();
  const timer = new Timer(); timer.toggle(start); timer.tick(start + 1500000);
  assert.equal(dayKey(start), '2026-09-05');
  assert.equal(timer.snapshot(start).today.count, 0);
  assert.equal(timer.snapshot(start + 1500000).today.count, 1);
});

test('calendar returns every session on a local day, with totals and date validation', () => {
  const timer = new Timer();
  const leapDay = new Date(2024, 1, 29, 12).getTime();
  timer.history = Array.from({ length: 8 }, (_, i) => ({ at: leapDay + i * 60000, minutes: 25, task: `Session ${i}` }));
  timer.history.push({ at: new Date(2024, 2, 1, 0).getTime(), minutes: 45, task: 'Tomorrow' });
  const day = timer.daySummary('2024-02-29');
  assert.equal(day.count, 8);
  assert.equal(day.minutes, 200);
  assert.equal(day.sessions.length, 8);
  assert.equal(day.sessions[0].task, 'Session 7');
  assert.equal(timer.snapshot(leapDay).today.sessions.length, 8);
  assert.equal(timer.snapshot(leapDay).today.count, 8);
  assert.deepEqual(timer.daySummary('2024-02-28'), { date:'2024-02-28', count:0, minutes:0, sessions:[] });
  for (const date of [null, {}, '', '2024-2-29', '2023-02-29', '2024-02-30', '2024-13-01']) assert.throws(() => timer.daySummary(date), /Invalid calendar date/);
});
