const $ = selector => document.querySelector(selector);
let state;
let toastTimeout;
let lastMoments = '';
let lastStorageError = '';
const dialog = $('#settings-dialog');
const form = $('#settings-form');

function toast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

async function act(action, value) {
  try { render(await window.still.action(action, value)); return true; }
  catch (error) { toast('Something went wrong. Please try again.'); console.error(error); return false; }
}

function render(next) {
  state = next;
  const { mode, settings, today, running, remainingMs, totalMs } = state;
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  const focusing = mode === 'focus';
  const fresh = remainingMs === totalMs && !running;
  document.documentElement.dataset.theme = settings.theme;
  $('#time').innerHTML = `${minutes}<span>:</span>${remainder}`;
  $('#time').setAttribute('aria-label', `${Number(minutes)} minutes ${Number(remainder)} seconds remaining`);
  document.title = `${minutes}:${remainder} · ${focusing ? 'Focus' : 'Break'} — Still`;
  $('#ring-progress').setAttribute('stroke-dashoffset', String(100 * (1 - remainingMs / totalMs)));
  $('#headline').textContent = focusing ? 'One thing at a time.' : 'A little room to breathe.';
  $('#session-eyebrow').textContent = focusing ? 'MAKE ROOM FOR WHAT MATTERS' : 'REST IS PART OF THE RHYTHM';
  $('#timer-status').textContent = running ? (focusing ? 'IN YOUR FOCUS FLOW' : 'TAKE A BREATH') : fresh ? (focusing ? 'TIME TO FOCUS' : 'TIME TO REST') : 'PAUSED, NOT BEHIND';
  $('#timer-caption').textContent = running ? (focusing ? 'Right here. One little thing.' : 'Step away. Come back refreshed.') : fresh ? (focusing ? 'A fresh start, just for you.' : 'You’ve earned a little space.') : 'Pick up when you’re ready.';
  $('#toggle-label').textContent = running ? 'Pause' : fresh ? (focusing ? 'Start focus' : 'Start break') : 'Resume';
  $('#play-icon').innerHTML = running ? '<path d="M7 5h3v14H7ZM14 5h3v14h-3Z"/>' : '<path d="m9 5 10 7-10 7Z"/>';
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  const currentRound = state.cycle + 1;
  $('#cycle-label').textContent = focusing ? `Session ${currentRound} of ${settings.rounds}` : mode === 'long' ? 'A longer pause. Well deserved.' : 'A small pause between sessions.';
  $('#cycle-dots').replaceChildren(...Array.from({ length: focusing ? settings.rounds : 0 }, (_, i) => {
    const dot = document.createElement('i');
    dot.className = i < state.cycle ? 'done' : i === state.cycle ? 'current' : '';
    return dot;
  }));
  if (document.activeElement !== $('#task')) $('#task').value = state.task;
  $('#focus-count').innerHTML = `${today.count}<span> / ${settings.goal}</span>`;
  $('#focus-minutes').innerHTML = `${today.minutes >= 60 ? (today.minutes / 60).toFixed(1) : today.minutes}<span> ${today.minutes >= 60 ? 'hrs' : 'min'}</span>`;
  $('#goal-track').replaceChildren(...Array.from({ length: settings.goal }, (_, i) => {
    const segment = document.createElement('i'); segment.className = i < today.count ? 'done' : ''; return segment;
  }));
  $('#goal-track').setAttribute('aria-label', `${today.count} of ${settings.goal} daily sessions completed`);
  $('#goal-copy').textContent = today.count >= settings.goal ? 'Your daily intention, beautifully met.' : today.count > 0 ? `${settings.goal - today.count} more ${settings.goal - today.count === 1 ? 'session' : 'sessions'} toward your daily intention.` : 'A little focus goes a long way.';
  $('#date').textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const moments = JSON.stringify(today.sessions);
  if (moments !== lastMoments) {
    lastMoments = moments;
    const list = $('#session-list');
    if (!today.sessions.length) list.innerHTML = '<div class="empty-state"><span class="sprout" aria-hidden="true">✳</span><p>A clear page.<br>A little possibility.</p><span>Your completed focus sessions<br>will find a home here.</span></div>';
    else list.replaceChildren(...today.sessions.map(session => {
      const item = document.createElement('div'); item.className = 'session-item';
      const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓';
      const detail = document.createElement('div');
      const title = document.createElement('p'); title.textContent = session.task || 'A moment of focus'; title.title = title.textContent;
      const metadata = document.createElement('small'); metadata.textContent = `${session.minutes} min · ${new Date(session.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      detail.append(title, metadata); item.append(check, detail); return item;
    }));
  }
  $('#footer-status').textContent = state.storageError ? 'Changes aren’t saved — check disk space.' : running ? 'A little less noise. A little more focus.' : 'Your pace. Your space.';
  if (state.storageError && state.storageError !== lastStorageError) toast(state.storageError);
  lastStorageError = state.storageError;
}

function openSettings() {
  if (!state || dialog.open) return;
  for (const [key, value] of Object.entries(state.settings)) {
    const input = form.elements.namedItem(key);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
  dialog.showModal();
}

$('#toggle').addEventListener('click', () => act('toggle'));
$('#reset').addEventListener('click', () => act('reset'));
$('#skip').addEventListener('click', () => act('skip'));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => act('mode', button.dataset.mode)));
$('#task').addEventListener('input', () => act('task', $('#task').value));
$('#settings-button').addEventListener('click', openSettings);
$('#close-settings').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = {};
  for (const key of Object.keys(state.settings)) {
    const input = form.elements.namedItem(key);
    values[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  }
  if (await act('settings', values)) { dialog.close(); toast(state.storageError || 'Your preferences are saved.'); }
});
$('#restore-defaults').addEventListener('click', () => {
  const defaults = { focus:25, short:5, long:15, rounds:4, goal:8, theme:'system', sound:true, notifications:true, autoBreak:false, autoFocus:false, alwaysOnTop:false };
  for (const [key, value] of Object.entries(defaults)) {
    const input = form.elements.namedItem(key); if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); openSettings(); return; }
  if (dialog.open || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest('input,select,textarea,button,a')) return;
  const actions = { ' ': 'toggle', r: 'reset', s: 'skip' };
  if (actions[event.key.toLowerCase()]) { event.preventDefault(); act(actions[event.key.toLowerCase()]); }
});

window.still.onState(render);
window.still.onPreferences(openSettings);
window.still.onComplete(async ({ sound }) => {
  toast('A session complete. Take a breath.');
  if (!sound) return;
  try {
    const audio = new AudioContext();
    await audio.resume();
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      const start = audio.currentTime + index * .18;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.09, start + .015); gain.gain.exponentialRampToValueAtTime(.001, start + .9);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + 1);
    });
    setTimeout(() => audio.close(), 1800);
  } catch (error) { console.error('Could not play completion sound:', error); }
});
window.still.getState().then(render).catch(() => toast('Still couldn’t load. Please restart the app.'));
