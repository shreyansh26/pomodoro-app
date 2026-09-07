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
    const running = await page.evaluate(() => window.still.getState());
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    const afterReselect = await page.evaluate(() => window.still.getState());
    assert.equal(afterReselect.running, true, 'clicking the active tab keeps the timer running');
    assert.ok(afterReselect.remainingMs <= running.remainingMs, 'clicking the active tab does not reset the countdown');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await page.locator('#time').textContent();
    const pausedState = await page.evaluate(() => window.still.getState());
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.still.getState()), pausedState, 'clicking the active tab preserves a paused session');
    await page.waitForTimeout(1200); assert.equal(await page.locator('#time').textContent(), paused);
    await page.locator('#task').fill('Build something meaningful');
    await page.locator('#task').dispatchEvent('keydown', { key:'Enter', isComposing:true });
    assert.equal(await page.locator('#task').evaluate(input => document.activeElement === input), true, 'IME confirmation keeps editing active');
    await page.locator('#task').press('Enter');
    assert.equal(await page.locator('#task').evaluate(input => document.activeElement === input), false, 'Enter finishes editing the session name');
    assert.equal((await page.evaluate(() => window.still.getState())).task, 'Build something meaningful');
    assert.equal(await page.locator('#time').textContent(), paused);
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
    const partial = new Timer();
    partial.configure({ sound:false, notifications:false });
    partial.task = 'Ended early';
    const partialStart = Date.now() - 20 * 60000;
    partial.toggle(partialStart);
    partial.toggle(partialStart + 16 * 60000 + 20000);
    await fs.writeFile(path.join(data, 'still-state.json'), JSON.stringify(partial.serialize(Date.now())));
    page = await launch();
    await page.getByRole('button', { name:'Skip session' }).click();
    assert.equal(await page.locator('#time').textContent(), '05:00');
    assert.equal(await page.locator('#focus-count').textContent(), '1 / 8');
    assert.equal(await page.locator('#focus-minutes').textContent(), '0h 16m 20s');
    assert.match(await page.locator('#session-list .session-item small').textContent(), /^16 min 20s · /);
    await page.getByRole('button', { name:'Open session calendar' }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    assert.equal(await page.locator('#history-total').textContent(), '0h 16m 20s');
    await page.screenshot({ path:path.join(artifacts, 'still-ended-early.png') });
    await app.close(); app = null;
    page = await launch();
    assert.equal(await page.locator('#session-list .session-item p').textContent(), 'Ended early');
    assert.equal(await page.locator('#focus-minutes').textContent(), '0h 16m 20s');
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
    assert.match(await page.locator('#session-list .session-item small').textContent(), /25 min · .+ – .+/);
    assert.equal(await page.locator('#time').textContent(), '05:00');
    assert.equal(await page.locator('#history-total').textContent(), '0h 25m');
    assert.equal(await page.locator('#history-next').isDisabled(), true);
    await page.getByRole('button', { name:'Previous day', exact:true }).click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '8');
    assert.equal(await page.locator('#history-date').inputValue(), dayKey(yesterday));
    assert.equal(await page.locator('#history-total').textContent(), '3h 40m');
    assert.equal(await page.locator('#history-list .session-item').count(), 8);
    assert.equal(await page.locator('#history-list .session-item p').first().textContent(), 'Review and reflect');
    assert.match(await page.locator('#history-list .session-item small').first().textContent(), /45 min · ≈.+ – .+/);
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
    await page.locator('#history-date-button').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
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
    await page.locator('#history-next').hover();
    assert.deepEqual(await page.locator('#history-next').evaluate(button => {
      const style = getComputedStyle(button);
      return [button.disabled, style.cursor, style.backgroundColor, style.transform];
    }), [true, 'default', 'rgba(0, 0, 0, 0)', 'none'], 'today’s next arrow is disabled without busy or hover effects');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height:width === 390 ? 650 : 790 });
      assert.equal(await page.locator('#history-dialog').evaluate(dialog => dialog.scrollHeight === dialog.clientHeight), true, 'only the session list should scroll');
      const navigation = await page.evaluate(async () => {
        const geometry = () => ['#history-dialog', '.history-navigation'].map(selector => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        });
        const baseline = geometry();
        const visits = [];
        for (const offset of [-1, -1, -1, 1, 1, 1]) {
          const before = document.querySelector('#history-results').textContent;
          const date = new Date(`${historyDate.value}T12:00:00`);
          date.setDate(date.getDate() + offset);
          historyDate.value = localDate(date);
          const pending = loadDay();
          const during = document.querySelector('#history-results').textContent;
          const summaryVisible = !document.querySelector('#history-summary').hidden;
          const pendingGeometry = geometry();
          await pending;
          visits.push({ preserved:before === during, summaryVisible, pendingGeometry, settledGeometry:geometry() });
        }
        return { baseline, visits };
      });
      for (const visit of navigation.visits) {
        assert.equal(visit.preserved && visit.summaryVisible, true, 'navigation keeps results visible until the replacement is ready');
        assert.deepEqual(visit.pendingGeometry, navigation.baseline, `calendar stays anchored while loading at ${width}px`);
        assert.deepEqual(visit.settledGeometry, navigation.baseline, `empty and populated days have the same height at ${width}px`);
      }
      if (width === 1440) await page.screenshot({ path:path.join(artifacts, 'still-calendar-maximized.png') });
    }
    await page.setViewportSize({ width:390, height:790 });
    await page.locator('#history-date-button').click();
    assert.equal(await page.locator('#date-picker').isVisible(), true);
    assert.equal(await page.locator('#picker-next').isDisabled(), true, 'future months are disabled');
    assert.equal(await page.locator('#picker-days button[aria-current="date"]').evaluate(button => document.activeElement === button), true, 'opening focuses the selected date');
    assert.equal(await page.locator('#date-picker').evaluate(picker => {
      const rect = picker.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && picker.scrollWidth === picker.clientWidth;
    }), true, 'the picker fits the compact window');
    const future = new Date(); future.setDate(future.getDate() + 1);
    assert.equal(await page.locator(`#picker-days button[data-date="${dayKey(future)}"]`).isDisabled(), true);
    await page.screenshot({ path:path.join(artifacts, 'still-date-picker-dark.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#date-picker').isVisible(), false);
    assert.equal(await page.locator('#history-dialog').isVisible(), true, 'Escape closes only the picker');
    assert.equal(await page.locator('#history-date-button').evaluate(button => document.activeElement === button), true);
    await page.locator('#history-date-button').click();
    await page.locator('#history-date-button').click();
    assert.equal(await page.locator('#date-picker').isVisible(), false, 'the date button also dismisses its picker');
    await page.locator('#history-date-button').click();
    await page.locator('#picker-year').selectOption('2024');
    await page.locator('#picker-month').selectOption('1');
    assert.equal(await page.locator('#picker-days button[data-date="2024-02-29"]').count(), 1, 'leap day is available');
    await page.locator('#picker-days button[data-date="2024-02-29"]').click();
    assert.equal(await page.locator('#history-date').inputValue(), '2024-02-29');
    await page.locator('#history-date-button').click();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#history-date').inputValue(), '2024-02-03', 'keyboard month/week navigation crosses month boundaries');
    await page.evaluate(() => window.still.action('settings', { theme:'light' }));
    await page.locator('#history-date-button').click();
    await page.locator('#picker-month').selectOption('1');
    await page.screenshot({ path:path.join(artifacts, 'still-date-picker-light.png') });
    await page.locator('#picker-year').selectOption('2023');
    assert.equal(await page.locator('#picker-days button[data-date="2023-02-29"]').count(), 0, 'non-leap February has only 28 days');
    await page.locator('#picker-today').click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    assert.equal(await page.locator('#history-date').inputValue(), dayKey(new Date()));
    await page.setViewportSize({ width:390, height:650 });
    await page.locator('#history-date-button').click();
    assert.equal(await page.locator('#date-picker').evaluate(picker => {
      const rect = picker.getBoundingClientRect();
      return rect.top >= 16 && rect.bottom <= innerHeight - 16;
    }), true, 'the picker stays on screen at the minimum window height');
    await page.locator('#picker-year').selectOption('1970');
    await page.locator('#picker-month').selectOption('0');
    assert.equal(await page.locator('#picker-previous').isDisabled(), true);
    await page.locator('#picker-days button[data-date="1970-01-01"]').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#picker-days button[data-date="1970-01-01"]').evaluate(button => document.activeElement === button), true, 'keyboard navigation respects the earliest date');
    await page.locator('#history-title').click();
    assert.equal(await page.locator('#date-picker').isVisible(), false, 'clicking outside dismisses the picker');
    await page.setViewportSize({ width:1020, height:840 });
    assert.equal(await page.evaluate(async () => { try { await window.still.getDay('2024-02-30'); return false; } catch { return true; } }), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-dialog').isVisible(), false);
    await page.evaluate(() => window.still.action('settings', { theme:'light' }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 840));
    await page.screenshot({ path: path.join(artifacts, 'still-completed.png') });
    await app.close(); app = null;
    const fullDay = new Timer(); fullDay.configure({ theme:'dark', sound:false, notifications:false });
    fullDay.history = Array.from({ length:7 }, (_, i) => ({ at:Date.now() - i, minutes:25, task:`Focus session ${7 - i}` }));
    await fs.writeFile(path.join(data, 'still-state.json'), JSON.stringify(fullDay.serialize(Date.now())));
    page = await launch();
    assert.equal(await page.locator('#session-list .session-item').count(), 7);
    assert.equal(await page.locator('#session-list .session-item p').last().textContent(), 'Focus session 1');
    assert.equal(await page.locator('#session-list').evaluate(list => list.scrollHeight > list.clientHeight), true, 'all sessions are available within a scrollable sidebar');
    await page.locator('.brand').hover();
    const hiddenScrollbar = await page.locator('#session-list').evaluate(list => getComputedStyle(list).scrollbarColor);
    assert.equal(hiddenScrollbar, 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
    const listWidth = await page.locator('#session-list').evaluate(list => list.clientWidth);
    await page.screenshot({ path:path.join(artifacts, 'still-moments-idle.png') });
    await page.locator('.recent').hover();
    assert.notEqual(await page.locator('#session-list').evaluate(list => getComputedStyle(list).scrollbarColor), hiddenScrollbar);
    assert.equal(await page.locator('#session-list').evaluate(list => list.clientWidth), listWidth, 'revealing the scrollbar must not shift session text');
    await page.screenshot({ path:path.join(artifacts, 'still-moments-scroll.png') });
    await page.locator('.brand').hover();
    await page.locator('#session-list').focus();
    await page.keyboard.press('End');
    assert.notEqual(await page.locator('#session-list').evaluate(list => getComputedStyle(list).scrollbarColor), hiddenScrollbar, 'keyboard scrolling reveals the scrollbar');
    await page.waitForFunction(() => {
      const list = document.querySelector('#session-list');
      // Native scrolling can stop one pixel short of rounded DOM dimensions at 1× scale.
      return Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 1;
    });
    const scrollTop = await page.locator('#session-list').evaluate(list => list.scrollTop);
    await page.waitForTimeout(1100);
    assert.ok(Math.abs(await page.locator('#session-list').evaluate(list => list.scrollTop) - scrollTop) <= 1, 'timer ticks preserve list scroll position within native pixel rounding');
    await page.keyboard.press('Space');
    assert.equal((await page.evaluate(() => window.still.getState())).running, false, 'scrolling the list must not start the timer');
    await page.screenshot({ path:path.join(artifacts, 'still-moments-scrolled.png') });
    // Emulate a tall viewport even when the CI runner has a small physical display.
    await page.setViewportSize({ width:1440, height:1200 });
    assert.equal(await page.locator('#session-list').evaluate(list => list.scrollHeight === list.clientHeight), true, 'a tall panel shows every session without unnecessary scrolling');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'the expanded session list stays within the window');
    await page.screenshot({ path:path.join(artifacts, 'still-moments-tall.png') });
    await page.setViewportSize({ width:1440, height:790 });
    assert.equal(await page.locator('#session-list').evaluate(list => list.scrollHeight > list.clientHeight), true, 'the list scrolls again when the window is shorter');
    await page.setViewportSize({ width:390, height:790 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'a populated sidebar fits the narrow layout');
    await page.screenshot({ path:path.join(artifacts, 'still-moments-narrow.png'), fullPage:true });
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
});
