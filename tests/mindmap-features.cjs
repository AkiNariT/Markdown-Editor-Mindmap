const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-features-')), profile = path.join(dir, 'profile');
  const mapFile = path.join(dir, '导图增强.mdmap'), noteFile = path.join(dir, '研究笔记.md'), conflictFile = path.join(dir, '已有笔记.md');
  const node = (id, text, parent = 'root') => ({ id, parent, text, file: null, collapsed: false });
  await writeFile(mapFile, JSON.stringify({ format: 'md-mindmap', version: 2, root: 'root', nodes: [node('root', '项目地图', null), node('a', '设计资料'), node('b', '实施方案'), node('create', '研究笔记'), node('cancel', '备用主题')], connections: [{ id: 'edge', from: 'a', to: 'b' }] }));
  await writeFile(conflictFile, '# 已有笔记\n\n保留原文件。\n');
  let app, page; const errors = [];
  const start = async files => {
    app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...files, '--user-data-dir=' + profile], timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-node-id=root]'); await idle();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  };
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const button = name => page.getByRole('button', { name, exact: true });
  const card = id => page.locator('[data-node-card="' + id + '"]');
  const save = async () => { await page.locator('#save').click(); await idle(); await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden); };
  const stored = target => readFile(target, 'utf8').then(JSON.parse);
  const labelClear = async () => {
    const overlaps = await page.locator('[data-connection-label=edge]').evaluate(label => {
      const r = label.getBoundingClientRect();
      return [...document.querySelectorAll('[data-node-card]')].filter(node => {
        const n = node.getBoundingClientRect();
        return Math.min(r.right, n.right) - Math.max(r.left, n.left) > 1 && Math.min(r.bottom, n.bottom) - Math.max(r.top, n.top) > 1;
      }).map(node => node.dataset.nodeCard);
    });
    assert.deepEqual(overlaps, [], 'connection description must stay clear of node cards');
  };
  const until = async (read, accept) => { for (let i = 0; i < 160; i++) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected recovery data was not persisted'); };
  const selectLine = async double => {
    const hit = page.locator('[data-connection-id=edge]'); await hit.scrollIntoViewIfNeeded();
    const point = await hit.evaluate(node => { const point = node.getPointAtLength(node.getTotalLength() / 2); const mapped = new DOMPoint(point.x, point.y).matrixTransform(node.getScreenCTM()); return { x: mapped.x, y: mapped.y }; });
    if (double) await page.mouse.dblclick(point.x, point.y); else await page.mouse.click(point.x, point.y);
  };
  const destroy = async () => { if (!app) return; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; };
  try {
    await start([mapFile]); const mapId = (await page.evaluate(() => window.moye.ready())).id;
    const back = async () => { await page.evaluate(id => window.moye.activateTab(id), mapId); await page.waitForSelector('[data-node-id=root]'); await idle(); };
    await button('编辑').click(); await idle();
    assert.equal(await page.locator('input[type=color]').count(), 0);
    for (const [id, palette] of [['root','gray'],['a','green'],['b','orange'],['create','blue'],['cancel','purple']]) {
      await page.locator('[data-node-id=' + id + ']').click(); await page.locator('[data-palette=' + palette + ']').click();
    }
    await save(); let value = await stored(mapFile); assert.equal(value.version, 4);
    assert.equal(value.nodes.find(node => node.id === 'create').background, '#dbeafe');
    assert.equal(value.nodes.find(node => node.id === 'create').color, '#1e3a5f');
    console.log('PASS paired palettes and v4 persistence without downgrade');

    await selectLine(true);
    const input = page.locator('.mindmap-connection-input'); await input.fill('参考资料 → 实施依据'); await input.blur();
    const label = page.locator('[data-connection-label=edge]'); assert.equal(await label.textContent(), '参考资料 → 实施依据');
    await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('F2');
    assert.equal(await input.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('#name-dialog').isVisible(), false, 'node/connection F2 must not open the document-name dialog');
    await input.blur();
    await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); assert.equal(await label.count(), 0);
    await page.keyboard.press('Control+y'); assert.equal(await label.textContent(), '参考资料 → 实施依据');
    await label.dblclick(); await input.fill(''); await input.blur(); assert.equal(await label.count(), 0);
    await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); assert.equal(await label.textContent(), '参考资料 → 实施依据');
    const oldCurve = await page.locator('[data-connection-line=edge]').getAttribute('d');
    const oldLabel = await label.boundingBox();
    await page.locator('[data-node-id=a]').scrollIntoViewIfNeeded();
    const box = await page.locator('[data-node-id=a]').boundingBox();
    await page.mouse.move(box.x + 55, box.y + 22); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + 47, { steps: 8 }); await page.mouse.up();
    assert.notEqual(await page.locator('[data-connection-line=edge]').getAttribute('d'), oldCurve);
    const newLabel = await label.boundingBox(); assert.ok(Math.abs(newLabel.x-oldLabel.x) > 2 || Math.abs(newLabel.y-oldLabel.y) > 2);
    await labelClear();
    await page.locator('#zoom-in').click(); assert.equal(await label.textContent(), '参考资料 → 实施依据');
    await save(); value = await stored(mapFile); assert.equal(value.connections[0].label, '参考资料 → 实施依据');
    assert.equal(value.nodes.find(node => node.id === 'a').background, '#dcf0df');
    await button('阅读').click(); await idle();
    console.log('PASS relation description editing, clear/undo/redo, node drag and zoom tracking, saved v4 label');

    await app.evaluate(({ dialog }, destination) => { globalThis.createCalls = 0; dialog.showSaveDialog = async (_win, options) => { globalThis.createCalls++; globalThis.createOptions = options; return { canceled: false, filePath: destination }; }; }, noteFile);
    await page.locator('[data-node-id=create]').dblclick();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '研究笔记.md'); await idle();
    assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'), 'true', 'new draft opens ready to edit');
    assert.equal(await page.locator('.tiptap h1').textContent(), '研究笔记');
    assert.equal(await app.evaluate(() => globalThis.createCalls), 0, 'opening a draft does not show a save dialog');
    await assert.rejects(readFile(noteFile), { code: 'ENOENT' }, 'opening a draft does not create a disk file');
    const draft = await page.evaluate(() => window.moye.ready()); assert.equal(draft.path, null); assert.equal(draft.suggestedName, '研究笔记.md');
    await button('源码').click(); const source = page.locator('.source-input');
    const editedNote = '# 研究笔记\n\n先写好的正文。\n'; await source.fill(editedNote);
    await back(); assert.equal(await page.locator('[data-open-node=create]').count(), 0, 'unsaved draft does not attach a file');
    await page.locator('[data-node-id=create]').dblclick(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '研究笔记.md'); await idle();
    assert.equal((await page.evaluate(() => window.moye.ready())).id, draft.id, 'repeated double-click reuses the draft');
    assert.equal(await page.getByRole('tab').count(), 2); assert.equal(await source.inputValue(), editedNote);
    assert.equal(await app.evaluate(() => globalThis.createCalls), 0);
    await page.keyboard.press('Control+s'); await idle(); await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden);
    assert.equal(await readFile(noteFile, 'utf8'), editedNote, 'first save includes edits made before choosing a path');
    assert.equal(path.basename((await app.evaluate(() => globalThis.createOptions)).defaultPath), '研究笔记.md');
    const calls = await app.evaluate(() => globalThis.createCalls);
    assert.equal(calls, 1, 'the first save requests a location once');
    await back(); assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await page.locator('[data-node-id=create]').dblclick(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '研究笔记.md'); await idle();
    assert.equal(await app.evaluate(() => globalThis.createCalls), calls, 'linked node opens without another creation dialog');
    await back(); await button('编辑').click(); await idle();
    await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); assert.equal(await page.locator('[data-open-node=create]').count(), 0);
    assert.equal(await readFile(noteFile, 'utf8'), editedNote, 'undo retains the edited file on disk');
    await page.keyboard.press('Control+y'); assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await save(); value = await stored(mapFile); assert.equal(value.nodes.find(node => node.id === 'create').file, '研究笔记.md');
    console.log('PASS unlinked node opens an editable draft without a dialog or file; repeat reuses draft; first save writes edits and attaches an undoable link');

    await app.evaluate(({ dialog }) => { globalThis.createCalls = 0; dialog.showSaveDialog = async () => { globalThis.createCalls++; return new Promise(resolve => { globalThis.releaseCreate = resolve; }); }; });
    await page.locator('[data-node-card=cancel]').evaluate(node => { node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '备用主题.md'); await idle();
    const canceledDraft = await page.evaluate(() => window.moye.ready());
    assert.equal(await page.getByRole('tab').count(), 3, 'duplicate gestures create only one draft');
    assert.equal(await app.evaluate(() => globalThis.createCalls), 0);
    await assert.rejects(readFile(path.join(dir, '备用主题.md')), { code: 'ENOENT' });
    await button('源码').click(); const canceledText = '# 备用主题\n\n取消保存后继续编辑。\n'; await source.fill(canceledText);
    await page.keyboard.press('Control+s');
    await until(() => app.evaluate(() => typeof globalThis.releaseCreate), value => value === 'function');
    await page.keyboard.press('Control+s');
    assert.equal(await app.evaluate(() => globalThis.createCalls), 1);
    await app.evaluate(() => globalThis.releaseCreate({ canceled: true })); await idle();
    const afterCancel = await page.evaluate(() => window.moye.ready()); assert.equal(afterCancel.id, canceledDraft.id); assert.equal(afterCancel.path, null);
    assert.equal(await source.inputValue(), canceledText, 'canceling the first save retains edited draft content');
    assert.equal(await page.locator('#dirty-dot').isVisible(), true);
    await back();
    assert.equal(await page.locator('[data-open-node=cancel]').count(), 0);
    await page.locator('[data-node-id=cancel]').dblclick(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '备用主题.md'); await idle();
    assert.equal((await page.evaluate(() => window.moye.ready())).id, canceledDraft.id);
    assert.equal(await source.inputValue(), canceledText); assert.equal(await page.getByRole('tab').count(), 3);
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, conflictFile);
    const bytes = await readFile(conflictFile);
    await page.keyboard.press('Control+s'); await idle();
    assert.deepEqual(await readFile(conflictFile), bytes, 'first save never overwrites a pre-existing file');
    assert.equal((await page.evaluate(() => window.moye.ready())).path, null); assert.equal(await source.inputValue(), canceledText);
    await back(); assert.equal(await page.locator('[data-open-node=cancel]').count(), 0);
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
    console.log('PASS canceled first save retains draft, duplicate gesture/save lock, existing-file protection and no temporary leftovers');

    const copyDir = path.join(dir, 'copy'); await mkdir(copyDir); const copy = path.join(copyDir, '导图副本.mdmap');
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, copy);
    await page.locator('#more-toggle').click(); await page.locator('#save-as').click(); await idle();
    value = await stored(copy); assert.equal(value.version, 4); assert.equal(value.connections[0].label, '参考资料 → 实施依据');
    assert.equal(value.nodes.find(node => node.id === 'create').file, '../研究笔记.md');
    for (const width of [1180, 720]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 820), width); await settle();
      await page.locator('[data-node-id=a]').click();
      await labelClear();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      for (const selector of ['[data-palette=blue]','.mindmap-theme-select']) assert.ok(await page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= canvas.top; }));
      if (width === 1180) { await button('居中').click(); await label.scrollIntoViewIfNeeded(); await settle(); await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD导图样式-0.1.21.png') }); }
    }
    await page.locator('#more-toggle').click(); await page.locator('#theme').click(); await settle();
    assert.equal(await card('b').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 234, 213)');
    await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD导图黑色窄屏-0.1.21.png') });
    await page.locator('#more-toggle').click(); await page.locator('#settings').click(); await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en'); await page.keyboard.press('Escape');
    assert.doesNotMatch((await page.locator('.mindmap-theme-select option').allTextContents()).join(' '), /\p{Script=Han}/u);
    await page.locator('[data-connection-label=edge]').dblclick(); await input.fill('Unsaved relation 草稿'); await input.blur();
    await page.locator('[data-node-id=a]').click(); await page.locator('[data-palette=brown]').click();
    await until(async () => { try { return JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')); } catch { return null; } }, value => value?.documents?.some(item => item.path === copy && item.draft?.includes('Unsaved relation 草稿') && item.draft.includes('#eadecf')));
    await destroy(); await start([]);
    assert.equal(await page.locator('[data-connection-label=edge]').textContent(), 'Unsaved relation 草稿');
    assert.equal(await card('a').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(234, 222, 207)');
    assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await save(); value = await stored(copy); assert.equal(value.connections[0].label, 'Unsaved relation 草稿'); assert.equal(value.nodes.find(node => node.id === 'a').background, '#eadecf');
    assert.deepEqual(errors, []);
    console.log('PASS v4 save-as links, compact/dark appearance, English controls, restart recovery of unsaved labels and backgrounds');
  } finally { await destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
