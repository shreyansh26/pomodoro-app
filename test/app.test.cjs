const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const executablePath = require('electron');
const { Timer } = require('../src/timer.cjs');

test('desktop flow, preferences, persistence, completion, security and responsive layouts', { timeout: 120000 }, async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'still-test-'));
  const artifacts = path.resolve('artifacts'); await fs.mkdir(artifacts, { recursive: true });
  let app;
  const launch = async () => {
    const env = { ...process.env, STILL_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, args: [path.resolve('.')], env });
    const page = await app.firstWindow(); await page.locator('#toggle-label').waitFor();
    await page.waitForFunction(() => !!window.still && document.title.includes('— Still'));
    return page;
  };
  try {
    let page = await launch();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.locator('#time').textContent(), '25:00');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
    await page.evaluate(() => window.still.action('settings', { theme: 'light' }));
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
    assert.equal(await page.evaluate(async () => { try { await window.still.action('mode', '__proto__'); return false; } catch { return true; } }), true);
    await app.close(); app = null;
    page = await launch();
    assert.equal(await page.locator('#time').textContent(), '30:00');
    assert.equal(await page.locator('#task').inputValue(), 'Build something meaningful');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await app.close(); app = null;
    const seed = new Timer(); seed.configure({ sound: false, notifications: false, theme: 'light' }); seed.task = 'Read a chapter';
    const now = Date.now(); seed.toggle(now - 1495000);
    await fs.writeFile(path.join(data, 'still-state.json'), JSON.stringify(seed.serialize(now)));
    page = await launch();
    await page.waitForFunction(() => document.querySelector('[data-mode=short]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#focus-count').textContent(), '1 / 8');
    assert.equal(await page.locator('.session-item p').textContent(), 'Read a chapter');
    assert.equal(await page.locator('#time').textContent(), '05:00');
    await page.screenshot({ path: path.join(artifacts, 'still-completed.png') });
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
});
