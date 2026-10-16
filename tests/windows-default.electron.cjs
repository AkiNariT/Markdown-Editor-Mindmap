const { _electron: electron } = require('playwright');
const { cp, mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'default-app-'));
  const source = path.resolve(__dirname, '../.packaged/MD-win32-x64');
  const fixture = path.join(dir, 'portable 中文');
  // Test an isolated packaged copy. Never execute the real registration script,
  // open system Settings or change the user's clipboard/default associations.
  await cp(source, fixture, { recursive: true, filter: name => path.basename(name) !== 'windows-integration.ps1' });
  const executablePath = path.join(fixture, 'MD.exe');
  const script = path.join(fixture, 'windows-integration.ps1');
  const file = path.join(dir, 'document.md');
  const original = '# Keep document\n\nOriginal text.\n';
  await writeFile(file, original);
  const app = await electron.launch({ executablePath, args: [file, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[role=tab]');
    await page.waitForFunction(() => !document.querySelector('#mode').disabled);
    assert.equal((await page.evaluate(() => window.moye.getAppInfo())).version, require('../package.json').version);
    assert.equal(await page.locator('#help-dialog small').textContent(), require('../package.json').version);
    await app.evaluate(({ shell, clipboard }) => {
      globalThis.settingsUris = []; globalThis.copiedPaths = []; globalThis.settingsFail = false;
      shell.openExternal = async uri => { globalThis.settingsUris.push(uri); if (globalThis.settingsFail) throw new Error('Settings test unavailable'); };
      clipboard.writeText = text => { globalThis.copiedPaths.push(text); };
    });
    await page.locator('[data-view=source]').click(); await page.locator('#mode').click();
    const draft = '# Keep document\n\nUnsaved draft stays here.\n';
    await page.locator('.source-input').fill(draft);
    const open = async () => { await page.locator('#more-toggle').click(); await page.locator('#settings').click(); };
    const click = async id => { await page.locator('#' + id).click(); await page.waitForFunction(id => !document.getElementById(id).disabled, id); };
    await open(); await click('default-app');
    assert.match(await page.locator('#default-app-cause').textContent(), /缺少设置组件/);
    assert.match(await page.locator('#default-app-status').textContent(), /已打开 Windows 设置/);
    await click('default-app-copy');
    assert.deepEqual(await app.evaluate(() => globalThis.copiedPaths), [executablePath]);
    assert.match(await page.locator('#default-app-cause').textContent(), /缺少设置组件/, 'copy does not hide the registration failure');
    // Extra renderer arguments cannot select a clipboard payload or Settings URI.
    await page.evaluate(() => window.moye.copyApplicationPath('attacker-selected-text'));
    assert.deepEqual(await app.evaluate(() => globalThis.copiedPaths), [executablePath, executablePath]);
    await page.evaluate(() => window.moye.openWindowsDefaultSettings('https://example.invalid'));
    assert.deepEqual(await app.evaluate(() => globalThis.settingsUris), ['ms-settings:defaultapps', 'ms-settings:defaultapps']);
    console.log('PASS packaged missing-helper error, manual settings independent of PowerShell, fixed main-owned clipboard path and fixed URI');

    await writeFile(script, 'param([string]$Action,[string]$ExecutablePath)\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\nthrow \'Registration conflict: <img src=x onerror="window.injected=true">\'\n');
    await click('default-app');
    assert.match(await page.locator('#default-app-cause').textContent(), /现有的应用记录/);
    await page.locator('#default-app-details-label').click();
    const diagnostic = await page.locator('#default-app-diagnostic').textContent();
    assert.match(diagnostic, /CONFLICT/); assert.match(diagnostic, /<img src=x/);
    assert.match(diagnostic, /portable 中文/); assert.doesNotMatch(diagnostic, /\uFFFD/);
    assert.equal(await page.locator('#default-app-diagnostic img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    for (const width of [1180, 720]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 740), width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.locator('#settings-dialog').evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && node.scrollWidth <= node.clientWidth;
      }));
    }
    await page.screenshot({ path: path.join(base, 'MD-default-app-error-zh.png') });
    await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.querySelector('#language-select').disabled);
    assert.match(await page.locator('#default-app-cause').textContent(), /existing application entry/);
    assert.equal(await page.locator('#default-app-diagnostic').textContent(), diagnostic.replace(/^自动注册：/, 'Registration: '));
    await page.screenshot({ path: path.join(base, 'MD-default-app-error-en.png') });
    console.log('PASS real PowerShell conflict reaches translated UI, inert error detail, retained language state and compact dialog layout');

    await app.evaluate(() => { globalThis.settingsFail = true; });
    await click('default-app');
    assert.match(await page.locator('#default-app-status').textContent(), /could not be opened/);
    assert.match(await page.locator('#default-app-diagnostic').textContent(), /Settings test unavailable/);
    assert.match(await page.locator('#default-app-cause').textContent(), /existing application entry/);
    await app.evaluate(() => { globalThis.settingsFail = false; });
    await click('default-app-settings');
    assert.match(await page.locator('#default-app-status').textContent(), /Settings is open/);
    assert.equal(await page.locator('#default-app-details').isVisible(), false);
    await writeFile(script, 'param([string]$Action,[string]$ExecutablePath)\nWrite-Output "{}"\n');
    await click('default-app');
    assert.match(await page.locator('#default-app-status').textContent(), /Choose MD/);
    assert.equal(await page.locator('#default-app-status').evaluate(node => node.classList.contains('form-error')), false);
    assert.equal(await page.locator('#default-app-cause').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.source-input').inputValue(), draft);
    assert.equal(await readFile(file, 'utf8'), original);
    assert.deepEqual(errors, []);
    console.log('PASS both failures retained, manual recovery and successful retry clear stale errors; unsaved document preserved');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
