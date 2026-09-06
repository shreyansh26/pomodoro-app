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
  timer.skip(now);
  assert.equal(timer.mode, 'short');
  assert.equal(timer.history.length, 0);
  assert.equal(timer.cycle, 0);
  timer.skip(now);
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

test('skipping records elapsed focus time, excludes pauses, and survives restart', () => {
  for (const paused of [false, true]) {
    const timer = new Timer({}, now);
    timer.task = 'A little progress';
    timer.toggle(now);
    timer.toggle(now + 10 * 60000);
    timer.toggle(now + 20 * 60000);
    if (paused) timer.toggle(now + 26 * 60000 + 20000);
    const end = now + (paused ? 40 * 60000 : 26 * 60000 + 20000);
    timer.skip(end);
    const expected = { at:end, startedAt:now, minutes:16 + 1 / 3, task:timer.task };
    assert.deepEqual(timer.history, [expected]);
    assert.equal(timer.mode, 'short');
    assert.equal(timer.deadline, null);
    assert.equal(timer.startedAt, null);
    assert.equal(timer.cycle, 1);
    const restored = new Timer(timer.serialize(end), end);
    assert.deepEqual(restored.history, [expected]);
    assert.equal(restored.snapshot(end).today.minutes, 16 + 1 / 3);
    restored.toggle(end);
    restored.skip(end + 1000);
    assert.equal(restored.mode, 'focus');
    assert.equal(restored.tick(end + 2000000), null);
    assert.deepEqual(restored.history, [expected]);
  }
});

test('skipped focus sessions count toward a long break and keep their start day', () => {
  const start = new Date(2026, 8, 5, 23, 59).getTime();
  const timer = new Timer({}, start);
  timer.configure({ rounds:1 });
  timer.toggle(start);
  timer.skip(start + 16 * 60000);
  assert.equal(timer.mode, 'long');
  assert.equal(timer.daySummary(dayKey(start)).minutes, 16);
  assert.equal(timer.snapshot(start + 16 * 60000).today.count, 0);
  timer.select('focus');
  timer.toggle(start + 90000);
  timer.skip(start + 90000);
  assert.equal(timer.mode, 'short');
  assert.equal(timer.history.length, 1, 'zero elapsed time does not create an empty session');
});

test('skip requires more than 15 minutes taken, regardless of time left or paused', () => {
  for (const elapsed of [0, 60000, 15 * 60000, 15 * 60000 + 1]) {
    const timer = new Timer({}, now);
    timer.configure({ focus:60 });
    timer.toggle(now);
    timer.toggle(now + elapsed);
    timer.skip(now + 2 * 3600000);
    const expected = elapsed > 15 * 60000 ? 1 : 0;
    assert.equal(timer.history.length, expected);
    assert.equal(timer.cycle, expected);
    assert.equal(timer.mode, 'short');
  }
  const timer = new Timer({}, now);
  timer.configure({ focus:16 });
  timer.toggle(now);
  timer.skip(now + 14 * 60000);
  assert.equal(timer.history.length, 0, 'only two minutes left still does not qualify');
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

test('today uses local dates and credits start time across midnight', () => {
  const start = new Date(2026, 8, 5, 23, 50).getTime();
  const timer = new Timer(); timer.toggle(start); timer.tick(start + 1500000);
  assert.equal(dayKey(start), '2026-09-05');
  assert.equal(timer.snapshot(start).today.count, 1);
  assert.equal(timer.snapshot(start + 1500000).today.count, 0);
  assert.equal(timer.snapshot(start + 1500000).cycle, 0);
});

test('calendar returns every session on a local day, with totals and date validation', () => {
  const timer = new Timer();
  const leapDay = new Date(2024, 1, 29, 12).getTime();
  timer.history = Array.from({ length: 8 }, (_, i) => ({ at: leapDay + i * 60000, minutes: 25, task: `Session ${i}` }));
  timer.history.push({ at: new Date(2024, 2, 1, 1).getTime(), minutes: 45, task: 'Tomorrow' });
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

test('daily cycle resets live and on restart, including legacy saved cycles', () => {
  const timer = new Timer({}, now);
  for (let i = 0; i < 3; i++) {
    timer.select('focus'); timer.toggle(now); timer.tick(now + 1500000);
  }
  assert.equal(timer.snapshot(now + 1500000).cycle, 3);
  const saved = timer.serialize(now + 1500000);
  const tomorrow = new Date(2026, 8, 6).getTime();
  timer.tick(tomorrow);
  assert.equal(timer.cycle, 0);
  assert.equal(new Timer(saved, tomorrow).cycle, 0);
  assert.equal(new Timer({ cycle:3 }, tomorrow).cycle, 0);
  timer.select('focus'); timer.toggle(tomorrow); timer.tick(tomorrow + 1500000);
  assert.equal(timer.mode, 'short');
  assert.equal(timer.cycle, 1);
});

test('pause, restart and late recovery preserve the original start day and range', () => {
  const start = new Date(2026, 8, 5, 23, 50).getTime();
  const timer = new Timer({}, start);
  timer.toggle(start); timer.toggle(start + 60000);
  const resume = start + 86400000;
  const restored = new Timer(timer.serialize(start + 60000), resume);
  assert.equal(restored.startedAt, start);
  restored.toggle(resume);
  restored.tick(resume + 86400000);
  assert.equal(restored.daySummary(dayKey(start)).count, 1);
  assert.equal(restored.history[0].startedAt, start);
  assert.equal(restored.history[0].at, resume + 1440000);
  assert.equal(restored.history[0].minutes, 25);
  assert.equal(restored.cycle, 0);
  restored.select('focus');
  assert.equal(restored.startedAt, null);
});

test('legacy history estimates starts and moves overnight records to their start day', () => {
  const at = new Date(2026, 8, 6, 0, 7).getTime();
  const timer = new Timer({ history:[{ at, minutes:25, task:'Legacy' }] }, at);
  assert.equal(timer.daySummary('2026-09-05').count, 1);
  assert.equal(timer.daySummary('2026-09-06').count, 0);
  assert.equal(timer.history[0].startedAt, null);
});
