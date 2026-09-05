const { app, BrowserWindow, ipcMain, Menu, Tray, Notification, nativeImage, powerMonitor, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Timer } = require('./timer.cjs');

if (process.env.STILL_TEST_DATA) app.setPath('userData', process.env.STILL_TEST_DATA);
app.setName('Still');
app.setAppUserModelId('com.shreyanshsingh.still');
const entry = path.join(__dirname, 'index.html');
let win, tray, timer, statePath, interval;
let quitting = false;
let storageError = '';
let lastTrayLabel = '';

function persist() {
  try {
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(timer.serialize(Date.now())), { mode: 0o600 });
    fs.renameSync(`${statePath}.tmp`, statePath);
    storageError = '';
  } catch (error) {
    storageError = 'Changes could not be saved. Check your available disk space and permissions.';
    console.error('Could not save timer:', error.message);
  }
}

function show() { if (win) { win.show(); win.focus(); } }
const labels = { focus: 'Focus', short: 'Short break', long: 'Long break' };

function broadcast() {
  const state = { ...timer.snapshot(Date.now()), storageError };
  if (win && !win.isDestroyed()) {
    win.webContents.send('state', state);
    win.setProgressBar(state.running ? 1 - state.remainingMs / state.totalMs : -1);
  }
  const seconds = Math.ceil(state.remainingMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (tray) {
    tray.setToolTip(`Still · ${labels[state.mode]} · ${clock}`);
    if (process.platform === 'darwin') tray.setTitle(state.running ? clock : '', { fontType: 'monospacedDigit' });
    const label = `${state.running}-${state.mode}`;
    if (label !== lastTrayLabel) {
      lastTrayLabel = label;
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Still', click: show },
        { label: state.running ? 'Pause timer' : 'Start timer', click: () => act('toggle') },
        { label: 'Reset session', click: () => act('reset') },
        { type: 'separator' },
        { label: 'Quit Still', click: () => app.quit() }
      ]));
    }
  }
  return state;
}

function tick() {
  const event = timer.tick(Date.now());
  if (event) {
    persist();
    if (timer.settings.notifications && Notification.isSupported()) {
      const notification = new Notification({ title: event.completed === 'focus' ? 'A little progress. Well done.' : 'Ready for a fresh start?',
        body: event.completed === 'focus' ? `Your ${labels[event.next].toLowerCase()} is ${timer.settings.autoBreak ? 'underway' : 'ready'}. Take a breath.` : 'Your next focus session is ready.',
        silent: true });
      notification.on('click', show);
      notification.show();
    }
    win?.webContents.send('complete', { sound: timer.settings.sound });
  }
  return broadcast();
}

function act(action, value) {
  tick();
  switch (action) {
    case 'toggle': timer.toggle(Date.now()); break;
    case 'reset': timer.select(timer.mode); break;
    case 'skip': timer.skip(); break;
    case 'mode': if (!['focus', 'short', 'long'].includes(value)) throw new Error('Invalid mode'); timer.select(value); break;
    case 'task': if (typeof value !== 'string' || value.length > 160) throw new Error('Invalid intention'); timer.task = value; break;
    case 'settings':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences');
      timer.configure(value);
      win.setAlwaysOnTop(timer.settings.alwaysOnTop);
      break;
    default: throw new Error('Unknown timer action');
  }
  persist();
  return broadcast();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    statePath = path.join(app.getPath('userData'), 'still-state.json');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the original state for recovery before writing any new data.
        try { fs.copyFileSync(statePath, `${statePath}.backup-${Date.now()}`); }
        catch (backupError) {
          dialog.showErrorBox('Still could not open your saved data', `Your data has been left untouched. ${backupError.message}`);
          app.quit(); return;
        }
        storageError = 'Saved data could not be read. A backup was preserved in the app data folder.';
      }
    }
    timer = new Timer(saved);
    win = new BrowserWindow({ width: 1020, height: 840, useContentSize: true, minWidth: 390, minHeight: 650,
      title: 'Still', backgroundColor: '#f8f7f3', autoHideMenuBar: true,
      icon: path.join(__dirname, '../assets/icon.png'),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      alwaysOnTop: timer.settings.alwaysOnTop,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === pathToFileURL(entry).href;
    ipcMain.handle('get-state', event => { if (!trusted(event)) throw new Error('Untrusted sender'); return tick(); });
    ipcMain.handle('get-day', (event, date) => { if (!trusted(event)) throw new Error('Untrusted sender'); return timer.daySummary(date); });
    ipcMain.handle('action', (event, action, value) => { if (!trusted(event)) throw new Error('Untrusted sender'); return act(action, value); });
    try {
      const icon = nativeImage.createFromPath(path.join(__dirname, process.platform === 'darwin' ? '../assets/trayTemplate.png' : '../assets/icon.png'))
        .resize({ width: process.platform === 'darwin' ? 16 : 24 });
      // Resizing returns a new image, so mark the final image for native menu-bar tinting.
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.on('click', show);
    } catch (error) { console.error('Tray unavailable:', error.message); }
    win.on('close', event => { if (!quitting && tray) { event.preventDefault(); win.hide(); } });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Still', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'File', submenu: [{ label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => { show(); win.webContents.send('preferences'); } }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' }
    ]));
    win.loadFile(entry);
    interval = setInterval(tick, 1000);
    powerMonitor.on('resume', tick);
    app.on('activate', show);
  });
}
app.on('before-quit', () => { quitting = true; clearInterval(interval); if (timer) persist(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
