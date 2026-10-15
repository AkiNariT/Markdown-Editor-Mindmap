const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'updates-'));
  const file = path.join(dir, 'update-test.md'); await writeFile(file, '# Keep my document\n\nOriginal text.\n');
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), file, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('[role=tab]'); await page.waitForFunction(() => !document.querySelector('#save').disabled);
    assert.equal(await page.locator('#check-updates').count(), 1, 'More menu provides Check for updates');
    assert.equal(await page.locator('#settings-check-updates').count(), 1, 'Settings also provides Check for updates');
    const info = await page.evaluate(() => window.moye.getAppInfo());
    assert.equal(info.version, require('../package.json').version);
    await app.evaluate(({ net, shell }, currentVersion) => {
      globalThis.updateCurrentVersion = currentVersion;
      globalThis.updateRequests = []; globalThis.openedReleases = []; globalThis.updateScenario = 'available';
      shell.openExternal = async value => { globalThis.openedReleases.push(value); };
      net.fetch = async (url, options) => {
        globalThis.updateRequests.push({ scenario: globalThis.updateScenario, url, headers: options.headers, method: options.method, credentials: options.credentials, body: options.body });
        if (globalThis.updateScenario === 'offline') throw new Error('offline');
        if (globalThis.updateScenario === 'rate') return new Response('{}', { status: 429 });
        if (globalThis.updateScenario === 'pending') await new Promise(resolve => { globalThis.finishUpdateRequest = resolve; });
        if (globalThis.updateScenario === 'empty') return Response.json([]);
        const version = globalThis.updateScenario === 'current' ? globalThis.updateCurrentVersion : '0.99.0';
        const root = 'https://github.com/AkiNariT/Markdown-Editor-Mindmap';
        return Response.json([{ tag_name: 'v' + version, draft: false, prerelease: true, name: 'MD preview', body: '# Changes\n<img src=x onerror="window.updateInjected=true">\nKeep this as text.', published_at: '2026-10-15T10:00:00Z', html_url: root + '/releases/tag/v' + version, assets: [{ name: 'MD-Windows-x64-' + version + '.zip', state: 'uploaded', size: 100, browser_download_url: root + '/releases/download/v' + version + '/MD-Windows-x64-' + version + '.zip' }] }]);
      };
    }, info.version);
    const open = async () => { await page.locator('#more-toggle').click(); await page.locator('#check-updates').click(); await page.locator('#update-dialog').waitFor({ state: 'visible' }); };
    const check = async () => { await page.locator('#update-check').click(); await page.waitForFunction(() => !document.querySelector('#update-check').disabled); };
    const close = async () => { await page.locator('#update-close').click(); await page.locator('#update-dialog').waitFor({ state: 'hidden' }); };
    await open();
    assert.match(await page.locator('#update-current-version').textContent(), new RegExp(info.version.replaceAll('.', '\\.')));
    assert.equal(await app.evaluate(() => globalThis.updateRequests.length), 0, 'opening dialog does not contact GitHub');
    await check();
    assert.match(await page.locator('#update-release-version').textContent(), /0\.99\.0/);
    assert.equal(await page.locator('#update-prerelease').isVisible(), true);
    assert.match(await page.locator('#update-release-notes').textContent(), /<img src=x/);
    assert.equal(await page.locator('#update-release-notes img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.updateInjected)), false);
    await page.locator('#update-download').click();
    assert.deepEqual(await app.evaluate(() => globalThis.openedReleases), ['https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.99.0']);
    const requests = await app.evaluate(() => globalThis.updateRequests);
    assert.equal(requests[0].url, 'https://api.github.com/repos/AkiNariT/Markdown-Editor-Mindmap/releases?per_page=100');
    assert.equal(requests[0].credentials, 'omit'); assert.equal(requests[0].body, undefined);
    assert.doesNotMatch(JSON.stringify(requests), /Keep my document|update-test|Authorization/i);
    await page.screenshot({ path: path.join(base, 'MD-updates-zh.png') }); await close();
    console.log('PASS explicit checking only, correct metadata, public prerelease, inert notes and official download page');

    await page.locator('[data-view=source]').click(); await page.locator('#mode').click(); await page.waitForFunction(() => !document.querySelector('#save').disabled);
    await app.evaluate(() => { globalThis.updateScenario = 'pending'; }); await open(); await page.locator('#update-check').click();
    await page.waitForFunction(() => document.querySelector('#update-check').disabled); await close();
    const draft = '# Keep my document\n\nSaved while checking.\n'; await page.locator('.source-input').fill(draft);
    await page.locator('#save').click(); await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelector('#save-state').textContent === '已保存');
    assert.equal(await readFile(file, 'utf8'), draft);
    await app.evaluate(() => globalThis.finishUpdateRequest()); await open();
    await page.waitForFunction(() => !document.querySelector('#update-check').disabled); await close();
    console.log('PASS closing update dialog leaves editing and saving available during network request');

    await page.locator('#more-toggle').click(); await page.locator('#settings').click(); await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.querySelector('#language-select').disabled);
    await page.locator('#settings-check-updates').click();
    await page.locator('#update-dialog').waitFor({ state: 'visible' });
    assert.doesNotMatch(await page.locator('#update-status').textContent(), /\p{Script=Han}/u);
    for (const scenario of ['offline', 'rate', 'current', 'empty']) {
      await app.evaluate((_, value) => { globalThis.updateScenario = value; }, scenario); await check();
      const status = await page.locator('#update-status').textContent();
      assert.ok(status.trim()); assert.doesNotMatch(status, /\p{Script=Han}|UPDATE_/u);
      if (scenario === 'offline' || scenario === 'rate') assert.equal(await page.locator('#update-release').isVisible(), false, JSON.stringify({ scenario, status, requests: await app.evaluate(() => globalThis.updateRequests.map(x => x.scenario)), errors }));
      if (scenario === 'current') assert.match(status, /latest|up.to.date|newer/i);
    }
    await app.evaluate(() => { globalThis.updateScenario = 'available'; }); await check();
    for (const width of [1180, 720]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 740), width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.locator('#update-dialog').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollWidth === innerWidth; }));
    }
    await page.screenshot({ path: path.join(base, 'MD-updates-en-compact.png') }); await close();
    await page.locator('#more-toggle').click(); await page.locator('#theme').click(); await open();
    await page.screenshot({ path: path.join(base, 'MD-updates-black.png') });
    assert.deepEqual(errors, []);
    console.log('PASS Settings entry, English states, offline/limit retry, current/unpublished and compact/black layouts; no renderer errors');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
