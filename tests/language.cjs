const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, rename, rmdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'language-')), profile = path.join(dir, 'profile');
  const file = path.join(dir, '保留 {name}.md');
  const original = '# 中文标题 stays unchanged\n\n' + Array.from({ length: 65 }, (_, i) => `## Chapter ${i}\n\n保留正文 ${i} unchanged.\n\n`).join('');
  await writeFile(file, original);
  const launch = async (files = []) => {
    const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...files, '--user-data-dir=' + profile], timeout: 30000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForSelector('[role=tab]');
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    await app.evaluate(({ dialog }) => {
      globalThis.dialogOptions = [];
      dialog.showOpenDialog = async (_win, options) => { globalThis.dialogOptions.push(options); return { canceled: true, filePaths: [] }; };
      dialog.showSaveDialog = async (_win, options) => { globalThis.dialogOptions.push(options); return { canceled: true }; };
      dialog.showMessageBox = async (_win, options) => { globalThis.dialogOptions.push(options); return { response: 1 }; };
    });
    return { app, page };
  };
  let { app, page } = await launch([file]);
  const errors = []; const track = () => page.on('pageerror', error => errors.push(error.message)); track();
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const settings = async () => { await page.locator('#more-toggle').click(); await page.locator('#settings').click(); };
  const language = async value => {
    await settings(); await page.locator('#language-select').selectOption(value);
    await page.waitForFunction(value => document.documentElement.lang === value && !document.querySelector('#language-select').disabled, value);
    await page.keyboard.press('Escape'); await settle();
  };
  const destroy = async () => { if (!app) return; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; };
  try {
    assert.equal(await page.locator('#open').getAttribute('aria-label'), '打开');
    assert.deepEqual(await page.evaluate(() => window.moye.getSettings()), { language: 'zh-CN' });
    await page.locator('[data-view=compare]').click(); await page.locator('#mode').click(); await idle();
    const input = page.locator('.source-input');
    const draft = original + 'UNSAVED 保留草稿\n'; await input.fill(draft);
    assert.equal(await page.locator('#save-state').textContent(), '尚未保存');
    await page.locator('#sync-scroll').uncheck();
    await page.locator('#zoom-in').click();
    await input.focus();
    await input.evaluate(node => { node.setSelectionRange(30, 35); node.scrollTop = 530; });
    await page.locator('.canvas').evaluate(node => node.scrollTo({ top: 850, behavior: 'instant' })); await settle();
    const before = await page.evaluate(() => {
      const input = document.querySelector('.source-input'); window.originalSource = input; window.originalEditor = document.querySelector('.tiptap');
      return { sourceTop: input.scrollTop, selection: [input.selectionStart, input.selectionEnd], canvasTop: document.querySelector('.canvas').scrollTop, zoom: document.querySelector('#zoom-reset').textContent };
    });
    await language('en');
    assert.equal(await page.locator('#open').getAttribute('aria-label'), 'Open');
    assert.equal(await input.getAttribute('aria-label'), 'Markdown source');
    assert.equal(await input.inputValue(), draft);
    assert.equal(await page.locator('#document-name').textContent(), path.basename(file));
    assert.equal(await page.locator('.tiptap h1').textContent(), '中文标题 stays unchanged');
    assert.equal(await readFile(file, 'utf8'), original);
    const after = await page.evaluate(() => {
      const input = document.querySelector('.source-input');
      return { sameSource: window.originalSource === input, sameEditor: window.originalEditor === document.querySelector('.tiptap'), sourceTop: input.scrollTop, selection: [input.selectionStart, input.selectionEnd], canvasTop: document.querySelector('.canvas').scrollTop, zoom: document.querySelector('#zoom-reset').textContent };
    });
    assert.ok(after.sameSource && after.sameEditor, 'live switch keeps editor instances');
    assert.deepEqual(after.selection, before.selection); assert.equal(after.zoom, before.zoom);
    assert.ok(Math.abs(after.sourceTop - before.sourceTop) <= 2, JSON.stringify({ before, after }));
    assert.ok(Math.abs(after.canvasTop - before.canvasTop) <= 2, JSON.stringify({ before, after }));
    await input.focus(); await page.keyboard.press('Control+z'); assert.equal(await input.inputValue(), original);
    assert.equal(await page.locator('#save-state').textContent(), 'Saved');
    await page.keyboard.press('Control+y'); assert.equal(await input.inputValue(), draft);
    assert.equal(await page.locator('#save-state').textContent(), 'Unsaved changes');
    assert.equal((await page.evaluate(() => window.moye.setLanguage('fr'))).error !== undefined, true);
    assert.deepEqual(await page.evaluate(() => window.moye.getSettings()), { language: 'en' });
    assert.equal(JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).language, 'en');
    console.log('PASS live English switch, persisted settings, strict locale validation, unchanged document/draft/selection/scroll/zoom and undo');

    // A real atomic-replace failure in this isolated profile must not switch
    // either process to a preference that was not successfully persisted.
    const settingsFile = path.join(profile, 'settings.json'), heldSettings = path.join(profile, 'settings.saved');
    await rename(settingsFile, heldSettings); await mkdir(settingsFile);
    try {
      await settings(); await page.locator('#language-select').selectOption('zh-CN');
      await page.locator('#settings-error').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
      assert.deepEqual(await page.evaluate(() => window.moye.getSettings()), { language: 'en' });
      assert.equal(await page.locator('#language-select').inputValue(), 'en');
      await page.keyboard.press('Escape');
    } finally { await rmdir(settingsFile); await rename(heldSettings, settingsFile); }
    console.log('PASS failed settings write leaves persisted and live languages unchanged');

    await page.locator('#open').click(); await idle();
    await page.locator('#more-toggle').click(); await page.locator('#save-as').click(); await idle();
    const nativeOptions = await app.evaluate(() => globalThis.dialogOptions);
    assert.ok(nativeOptions.length >= 2);
    for (const options of nativeOptions) assert.doesNotMatch([options.title, options.buttonLabel, ...(options.filters || []).map(item => item.name)].join(' '), /\p{Script=Han}/u);
    const renameError = await page.evaluate(async () => { const state = await window.moye.ready(); return window.moye.renameDocument(state.id, 'CON'); });
    assert.ok(renameError.error); assert.doesNotMatch(renameError.error, /\p{Script=Han}/u);
    await page.locator('#skill-template').click(); await idle();
    assert.equal(await page.locator('#skill-name').getAttribute('aria-label'), 'Skill name');
    assert.doesNotMatch(await page.locator('.tiptap').textContent(), /\p{Script=Han}/u);
    await page.locator('#new-mindmap').click(); await idle();
    assert.equal(await page.locator('.mindmap-node-title').first().textContent(), 'Central topic');
    const mapInput = page.locator('.mindmap-text-input');
    await mapInput.fill('用户节点 Unchanged'); await mapInput.blur();
    const mapBefore = await mapInput.inputValue();
    await language('zh-CN'); assert.equal(await mapInput.inputValue(), mapBefore);
    assert.equal(await page.locator('.mindmap-node-title').first().textContent(), mapBefore);
    await language('en'); assert.equal(await mapInput.inputValue(), mapBefore);
    await page.locator('.mindmap-node').first().click({ button: 'right' });
    assert.doesNotMatch((await page.locator('.mindmap-context-menu button').allTextContents()).join(' '), /\p{Script=Han}/u);
    assert.equal(await page.locator('.mindmap-menu-header').textContent(), 'Selected node: ' + mapBefore);
    await page.keyboard.press('Escape');
    console.log('PASS native file dialogs, validation errors, English SKILL template and mindmap UI without node translation');

    const mapId = (await page.evaluate(() => window.moye.ready())).id;
    for (const width of [1180, 720]) {
      await page.evaluate(id => window.moye.activateTab(id), mapId); await idle();
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 740), width); await settle();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.ok(await page.locator('.mindmap-toolbar').evaluate(node => [...node.querySelectorAll('button')].every(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })));
      await settings();
      assert.ok(await page.locator('#language-select').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom < innerHeight; }));
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: path.basename(file), exact: true }).click(); await idle(); await settle();
      assert.ok(await page.evaluate(() => { const bar = document.querySelector('.page-bar').getBoundingClientRect(); const source = document.querySelector('#source-container').getBoundingClientRect(), canvas = document.querySelector('.canvas').getBoundingClientRect(); return document.documentElement.scrollWidth === innerWidth && source.top >= bar.bottom - 1 && canvas.top >= bar.bottom - 1 && [...document.querySelectorAll('#edit-controls > *:not([hidden])')].every(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= bar.bottom + 1; }); }));
      if (width === 1180) await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD-English-0.1.20.png') });
      else await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD-English-compact-0.1.20.png') });
    }
    console.log('PASS English layouts at 1180 and 720 CSS pixels; toolbars do not cover document text');
    const closing = page.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closing; await app.close().catch(() => {}); app = null;
    ({ app, page } = await launch()); track();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.locator('#open').getAttribute('aria-label'), 'Open');
    await page.locator('#new').click(); await idle();
    assert.match(await page.locator('#document-name').textContent(), /Untitled/);
    await language('zh-CN'); assert.equal(await page.locator('#open').getAttribute('aria-label'), '打开');
    assert.equal(JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).language, 'zh-CN');
    assert.deepEqual(errors, []);
    console.log('PASS English after restart, new document defaults and switch back to Chinese; no renderer errors');
  } finally { await destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
