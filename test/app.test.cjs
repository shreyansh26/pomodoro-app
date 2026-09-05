const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const executablePath = require('electron');
const { Timer, dayKey } = require('../src/timer.cjs');

test('desktop flow, preferences, persistence, completion, security and responsive layouts', { timeout: 120000 }, async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'still-test-'));
  const artifacts = path.resolve('artifacts'); await fs.mkdir(artifacts, { recursive: true });
  const trayProbe = path.join(data, 'tray-probe.cjs');
  await fs.writeFile(trayProbe, `
    const electron = require('electron');
    const NativeTray = electron.Tray;
    const Tray = class extends NativeTray {
      constructor(image) {
        super(image);
        globalThis.stillTrayImageIsTemplate = image.isTemplateImage();
        globalThis.stillTrayImageSize = image.getSize();
      }
    };
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      return name === 'electron' ? { ...electron, Tray } : load.call(this, name, ...args);
    };
    require(${JSON.stringify(path.resolve('src/main.cjs'))});
    Module._load = load;
  `);
  let app;
  const launch = async () => {
    const env = { ...process.env, STILL_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, args: [process.platform === 'darwin' ? trayProbe : path.resolve('.')], env });
    const page = await app.firstWindow(); await page.locator('#toggle-label').waitFor();
    await page.waitForFunction(() => !!window.still && document.title.includes('— Still'));
    return page;
  };
  try {
    let page = await launch();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (process.platform === 'darwin') assert.equal(await app.evaluate(() => globalThis.stillTrayImageIsTemplate), true, 'the final tray image is a macOS template after resizing');
    if (process.platform === 'darwin') assert.deepEqual(await app.evaluate(() => globalThis.stillTrayImageSize), { width:16, height:16 }, 'menu-bar icon uses the standard square size beside the native countdown');
    assert.equal(await page.locator('#time').textContent(), '25:00');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
    await page.evaluate(() => window.still.action('settings', { theme: 'light' }));
    const durationLabels = await page.evaluate(async () => {
      const snapshot = await window.still.getState();
      const labels = [0, 59, 60, 100, 125].map(minutes => {
        render({ ...snapshot, today:{ ...snapshot.today, minutes } });
        return document.querySelector('#focus-minutes').textContent;
      });
      render(snapshot);
      return labels;
    });
    assert.deepEqual(durationLabels, ['0h 0m', '0h 59m', '1h 0m', '1h 40m', '2h 5m']);
    // Small CI displays can constrain the native window below the requested height.
    if (await page.evaluate(() => innerHeight >= 840)) assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'default window fits without scrolling');
    await page.screenshot({ path: path.join(artifacts, 'still-light.png') });
    await page.getByRole('button', { name: 'Start focus', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#time').textContent !== '25:00');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await page.locator('#time').textContent();
    await page.waitForTimeout(1200); assert.equal(await page.locator('#time').textContent(), paused);
    await page.locator('#task').fill('Build something meaningful');
    await page.locator('#task').press('Tab');
    await page.getByRole('button', { name: 'Open preferences' }).click();
    await page.locator('[name=focus]').fill('30');
    await page.locator('[name=theme]').selectOption('dark');
    await page.locator('[name=alwaysOnTop]').check();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    assert.equal(await page.locator('#time').textContent(), paused);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
    await page.getByRole('button', { name: 'Reset session' }).click();
    assert.equal(await page.locator('#time').textContent(), '30:00');
    await page.getByRole('button', { name: 'Short break', exact: true }).click();
    assert.equal(await page.locator('#time').textContent(), '05:00');
    assert.equal(await page.locator('#cycle-dots .done').count(), 0);
    await page.getByRole('button', { name: 'Skip session' }).click();
    assert.equal(await page.locator('#time').textContent(), '30:00');
    await page.screenshot({ path: path.join(artifacts, 'still-dark.png') });
    await page.getByRole('button', { name: 'Open preferences' }).click();
    await page.screenshot({ path: path.join(artifacts, 'still-preferences.png') });
    await page.keyboard.press('Escape');
    for (const width of [390, 768, 1024, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 790), width);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
      if (width === 390) await page.screenshot({ path: path.join(artifacts, 'still-narrow.png'), fullPage: true });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const input = getComputedStyle(document.querySelector('#task'));
      return { width:innerWidth, height:innerHeight, appWidth:rect('.app').width,
        dial:rect('.timer-face').width, digits:rect('#time').width, footer:rect('footer').bottom,
        scrollWidth:document.documentElement.scrollWidth, paddingLeft:parseFloat(input.paddingLeft), paddingRight:parseFloat(input.paddingRight) };
    });
    assert.ok(layout.appWidth >= layout.width * .95, 'maximized layout uses the window width');
    assert.ok(layout.scrollWidth <= layout.width, 'maximized layout has no horizontal overflow');
    assert.ok(layout.digits < layout.dial, 'timer digits fit the dial');
    assert.ok(layout.paddingLeft >= 10 && layout.paddingRight >= 10, 'editing text has room on both sides');
    if (layout.width >= 1440 && layout.height >= 940) {
      assert.ok(layout.dial > 340, 'timer grows in a large window');
      assert.ok(Math.abs(layout.footer - layout.height) <= 2, 'footer follows the window bottom');
    }
    await page.evaluate(() => window.still.action('settings', { theme: 'light' }));
    await page.locator('#task').focus();
    await page.screenshot({ path: path.join(artifacts, 'still-maximized.png') });
    await page.evaluate(() => window.still.action('settings', { theme: 'dark' }));
    assert.equal(await page.evaluate(async () => { try { await window.still.action('mode', '__proto__'); return false; } catch { return true; } }), true);
    await app.close(); app = null;
    page = await launch();
    assert.equal(await page.locator('#time').textContent(), '30:00');
    assert.equal(await page.locator('#task').inputValue(), 'Build something meaningful');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await app.close(); app = null;
    const seed = new Timer(); seed.configure({ sound: false, notifications: false, theme: 'light' }); seed.task = 'Read a chapter';
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(8, 0, 0, 0);
    seed.history = ['<img src=x onerror="alert(1)">', '   ', 'Read a chapter', 'Plan the week', 'Deep work', 'Sketch the next idea', 'Write the first draft', 'Review and reflect'].map((task, i) => ({ at:yesterday.getTime() + i * 3600000, minutes:i === 7 ? 45 : 25, task }));
    const now = Date.now(); seed.toggle(now - 1495000);
    await fs.writeFile(path.join(data, 'still-state.json'), JSON.stringify(seed.serialize(now)));
    page = await launch();
    await page.getByRole('button', { name:'Open session calendar' }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    await page.waitForFunction(() => document.querySelector('[data-mode=short]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#focus-count').textContent(), '1 / 8');
    assert.equal(await page.locator('#session-list .session-item p').textContent(), 'Read a chapter');
    assert.equal(await page.locator('#time').textContent(), '05:00');
    assert.equal(await page.locator('#history-total').textContent(), '0h 25m');
    assert.equal(await page.locator('#history-next').isDisabled(), true);
    await page.getByRole('button', { name:'Previous day', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '8');
    assert.equal(await page.locator('#history-date').inputValue(), dayKey(yesterday));
    assert.equal(await page.locator('#history-total').textContent(), '3h 40m');
    assert.equal(await page.locator('#history-list .session-item').count(), 8);
    assert.equal(await page.locator('#history-list .session-item p').first().textContent(), 'Review and reflect');
    assert.equal(await page.locator('#history-list img').count(), 0);
    assert.ok((await page.locator('#history-list').textContent()).includes('A moment of focus'));
    await page.screenshot({ path:path.join(artifacts, 'still-calendar-light.png') });
    await page.evaluate(() => window.still.action('settings', { theme:'dark' }));
    await page.screenshot({ path:path.join(artifacts, 'still-calendar-dark.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 790));
    assert.equal(await page.evaluate(() => { const dialog = document.querySelector('#history-dialog'); return dialog.scrollWidth <= dialog.clientWidth && dialog.getBoundingClientRect().right <= innerWidth; }), true);
    await page.screenshot({ path:path.join(artifacts, 'still-calendar-narrow.png') });
    await page.getByRole('button', { name:'Previous day', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '0');
    assert.equal(await page.locator('#history-total').textContent(), '0h 0m');
    await page.locator('#history-date').fill(dayKey(yesterday));
    await page.locator('#history-date').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '8');
    await page.getByRole('button', { name:'Today', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    await page.evaluate(() => {
      window.calendarMutations = 0;
      window.calendarObserver = new MutationObserver(records => { window.calendarMutations += records.length; });
      window.calendarObserver.observe(document.querySelector('#history-results'), { subtree:true, childList:true, attributes:true, characterData:true });
    });
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name:'Today', exact:true }).click();
    await page.locator('#history-date').dispatchEvent('change');
    assert.equal(await page.evaluate(() => { window.calendarObserver.disconnect(); return window.calendarMutations; }), 0, 'reselecting the displayed day must not clear or redraw the calendar');
    assert.equal(await page.evaluate(async () => { try { await window.still.getDay('2024-02-30'); return false; } catch { return true; } }), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-dialog').isVisible(), false);
    await page.evaluate(() => window.still.action('settings', { theme:'light' }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 840));
    await page.screenshot({ path: path.join(artifacts, 'still-completed.png') });
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
});
