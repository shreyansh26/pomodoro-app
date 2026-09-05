// Wall-clock deadlines keep the timer accurate across throttling and sleep.
const DEFAULTS = Object.freeze({ focus: 25, short: 5, long: 15, rounds: 4, goal: 8,
  sound: true, notifications: true, autoBreak: false, autoFocus: false,
  alwaysOnTop: false, theme: 'system' });
const MODES = ['focus', 'short', 'long'];
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

function settingsFrom(input = {}) {
  const out = { ...DEFAULTS };
  for (const key of ['focus', 'short', 'long', 'rounds', 'goal']) {
    const max = ['rounds', 'goal'].includes(key) ? 12 : 120;
    if (Number.isInteger(input?.[key]) && finite(input[key], 1, max)) out[key] = input[key];
  }
  for (const key of ['sound', 'notifications', 'autoBreak', 'autoFocus', 'alwaysOnTop']) {
    if (typeof input?.[key] === 'boolean') out[key] = input[key];
  }
  if (['system', 'light', 'dark'].includes(input?.theme)) out.theme = input.theme;
  return out;
}

function dayKey(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

class Timer {
  constructor(saved = {}, now = Date.now()) {
    this.settings = settingsFrom(saved?.settings);
    this.mode = MODES.includes(saved?.mode) ? saved.mode : 'focus';
    this.totalMs = finite(saved?.totalMs, 60000, 7200000) ? saved.totalMs : this.settings[this.mode] * 60000;
    this.remainingMs = finite(saved?.remainingMs, 0, this.totalMs) ? saved.remainingMs : this.totalMs;
    this.deadline = finite(saved?.deadline, 1, now + this.totalMs) ? saved.deadline : null;
    this.cycle = Number.isInteger(saved?.cycle) && finite(saved.cycle, 0, this.settings.rounds - 1) ? saved.cycle : 0;
    this.task = typeof saved?.task === 'string' ? saved.task.slice(0, 160) : '';
    this.history = Array.isArray(saved?.history) ? saved.history.filter(item =>
      item && finite(item.at, 1, now) && finite(item.minutes, 1, 120) && typeof item.task === 'string'
    ).slice(-2000).map(item => ({ at: item.at, minutes: item.minutes, task: item.task.slice(0, 160) })) : [];
  }

  remaining(now) { return this.deadline === null ? this.remainingMs : Math.max(0, this.deadline - now); }

  select(mode) {
    if (!MODES.includes(mode)) return;
    this.mode = mode;
    this.totalMs = this.settings[mode] * 60000;
    this.remainingMs = this.totalMs;
    this.deadline = null;
  }

  toggle(now) {
    if (this.deadline === null) this.deadline = now + this.remainingMs;
    else { this.remainingMs = this.remaining(now); this.deadline = null; }
  }

  nextMode() { return this.mode === 'focus' ? (this.cycle === 0 ? 'long' : 'short') : 'focus'; }

  skip() {
    // Skipped focus sessions never count toward progress or a long break.
    this.select(this.mode === 'focus' ? 'short' : 'focus');
  }

  tick(now) {
    if (this.deadline === null || now < this.deadline) return null;
    const completed = this.mode;
    const at = this.deadline;
    if (completed === 'focus') {
      this.history.push({ at, minutes: this.totalMs / 60000, task: this.task });
      this.history = this.history.slice(-2000);
      this.cycle = (this.cycle + 1) % this.settings.rounds;
    }
    this.select(this.nextMode());
    // On wake, complete only the elapsed session; never invent unattended rounds.
    if (completed === 'focus' ? this.settings.autoBreak : this.settings.autoFocus) this.toggle(now);
    return { completed, next: this.mode };
  }

  configure(input) {
    this.settings = settingsFrom({ ...this.settings, ...input });
    this.cycle %= this.settings.rounds;
    // A duration edit applies next session, unless this session hasn't started.
    if (this.deadline === null && this.remainingMs === this.totalMs) this.select(this.mode);
  }

  snapshot(now) {
    const today = this.history.filter(item => dayKey(item.at) === dayKey(now));
    return { settings: this.settings, mode: this.mode, totalMs: this.totalMs, cycle: this.cycle,
      task: this.task, remainingMs: this.remaining(now), running: this.deadline !== null,
      today: { count: today.length, minutes: today.reduce((sum, item) => sum + item.minutes, 0), sessions: today.slice(-5).reverse() } };
  }

  serialize(now) {
    return { settings: this.settings, mode: this.mode, totalMs: this.totalMs,
      remainingMs: this.remaining(now), deadline: this.deadline, cycle: this.cycle,
      task: this.task, history: this.history };
  }
}

module.exports = { Timer, DEFAULTS, settingsFrom, dayKey };
