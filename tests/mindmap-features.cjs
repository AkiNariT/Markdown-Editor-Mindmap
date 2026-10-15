const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-features-')), profile = path.join(dir, 'profile');
  const mapFile = path.join(dir, '导图增强.mdmap'), noteFile = path.join(dir, '研究笔记.md');
  const node = (id, text, parent = 'root') => ({ id, parent, text, file: null, collapsed: false });
  await writeFile(mapFile, JSON.stringify({ format: 'md-mindmap', version: 2, root: 'root', nodes: [node('root', '项目地图', null), node('a', '设计资料'), node('b', '实施方案'), node('create', '研究笔记'), node('cancel', '备用主题')], connections: [{ id: 'edge', from: 'a', to: 'b' }] }));
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
  const chooseColor = (selector, color) => page.locator(selector).evaluate((input, color) => { input.value = color; input.dispatchEvent(new Event('change', { bubbles: true })); }, color);
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
    assert.equal(await page.locator('.mindmap-background-input').count(), 1, 'node background control is available');
    for (const [id, style, background] of [['root','plain','#e2e8f0'],['a','rounded','#d9e9df'],['b','note','#fde68a'],['create','capsule','#1e3a5f'],['cancel','double','#e9d5ff']]) {
      await page.locator('[data-node-id=' + id + ']').click();
      await page.locator('.mindmap-style-select').selectOption(style); await chooseColor('.mindmap-background-input', background);
    }
    await page.locator('[data-node-id=create]').click();
    assert.equal(await card('create').locator('.mindmap-node-title').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    await chooseColor('.mindmap-color-input', '#60a5fa');
    assert.equal(await card('create').locator('.mindmap-node-title').evaluate(node => getComputedStyle(node).color), 'rgb(96, 165, 250)');
    await save(); let value = await stored(mapFile); assert.equal(value.version, 4);
    assert.equal(value.nodes.find(node => node.id === 'b').style, 'note'); assert.equal(value.nodes.find(node => node.id === 'create').background, '#1e3a5f');
    assert.equal(value.nodes.find(node => node.id === 'create').color, '#60a5fa');
    console.log('PASS five styles, independent background/text colors, automatic contrast, v4 persistence without downgrade');

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
    assert.equal(value.nodes.find(node => node.id === 'a').style, 'rounded');
    await button('阅读').click(); await idle();
    console.log('PASS relation description editing, clear/undo/redo, node drag and zoom tracking, saved v4 label');

    await app.evaluate(({ dialog }, destination) => { globalThis.createCalls = 0; dialog.showSaveDialog = async (_win, options) => { globalThis.createCalls++; globalThis.createOptions = options; return { canceled: false, filePath: destination }; }; }, noteFile);
    await page.locator('[data-node-id=create]').dblclick();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '研究笔记.md'); await idle();
    assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'), 'true', 'new file opens ready to edit');
    assert.equal(await page.locator('.tiptap h1').textContent(), '研究笔记');
    assert.equal(await readFile(noteFile, 'utf8'), '# 研究笔记\n\n');
    assert.equal(path.basename((await app.evaluate(() => globalThis.createOptions)).defaultPath), '研究笔记.md');
    const calls = await app.evaluate(() => globalThis.createCalls);
    await back(); assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await page.locator('[data-node-id=create]').dblclick(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '研究笔记.md'); await idle();
    assert.equal(await app.evaluate(() => globalThis.createCalls), calls, 'linked node opens without another creation dialog');
    await back(); await button('编辑').click(); await idle();
    await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); assert.equal(await page.locator('[data-open-node=create]').count(), 0);
    assert.equal(await readFile(noteFile, 'utf8'), '# 研究笔记\n\n', 'undo retains the file on disk');
    await page.keyboard.press('Control+y'); assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await save(); value = await stored(mapFile); assert.equal(value.nodes.find(node => node.id === 'create').file, '研究笔记.md');
    console.log('PASS double-click unlinked node creates, links and opens editable Markdown; repeat open and undo/redo retain disk file');

    await app.evaluate(({ dialog }) => { globalThis.createCalls = 0; dialog.showSaveDialog = async () => { globalThis.createCalls++; return new Promise(resolve => { globalThis.releaseCreate = resolve; }); }; });
    await page.locator('[data-node-id=cancel]').dblclick();
    await until(() => app.evaluate(() => typeof globalThis.releaseCreate), value => value === 'function');
    await page.locator('[data-node-card=cancel]').evaluate(node => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    assert.equal(await app.evaluate(() => globalThis.createCalls), 1);
    await app.evaluate(() => globalThis.releaseCreate({ canceled: true })); await idle();
    assert.equal(await page.locator('[data-open-node=cancel]').count(), 0);
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, noteFile);
    const bytes = await readFile(noteFile);
    await page.locator('[data-node-id=cancel]').dblclick(); await idle();
    assert.deepEqual(await readFile(noteFile), bytes); assert.equal(await page.locator('[data-open-node=cancel]').count(), 0);
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
    console.log('PASS canceled creation, duplicate gesture lock, existing-file protection and no temporary leftovers');

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
      for (const selector of ['.mindmap-background-input','.mindmap-style-select']) assert.ok(await page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= canvas.top; }));
      if (width === 1180) { await button('居中').click(); await label.scrollIntoViewIfNeeded(); await settle(); await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD导图样式-0.1.21.png') }); }
    }
    await page.locator('#more-toggle').click(); await page.locator('#theme').click(); await settle();
    assert.equal(await card('b').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(253, 230, 138)');
    await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD导图黑色窄屏-0.1.21.png') });
    await page.locator('#more-toggle').click(); await page.locator('#settings').click(); await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en'); await page.keyboard.press('Escape');
    assert.doesNotMatch((await page.locator('.mindmap-style-select option').allTextContents()).join(' '), /\p{Script=Han}/u);
    await page.locator('[data-connection-label=edge]').dblclick(); await input.fill('Unsaved relation 草稿'); await input.blur();
    await page.locator('[data-node-id=a]').click(); await chooseColor('.mindmap-background-input', '#164e63');
    await until(async () => { try { return JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')); } catch { return null; } }, value => value?.documents?.some(item => item.path === copy && item.draft?.includes('Unsaved relation 草稿') && item.draft.includes('#164e63')));
    await destroy(); await start([]);
    assert.equal(await page.locator('[data-connection-label=edge]').textContent(), 'Unsaved relation 草稿');
    assert.equal(await card('a').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 78, 99)');
    assert.equal(await page.locator('[data-open-node=create]').count(), 1);
    await save(); value = await stored(copy); assert.equal(value.connections[0].label, 'Unsaved relation 草稿'); assert.equal(value.nodes.find(node => node.id === 'a').background, '#164e63');
    assert.deepEqual(errors, []);
    console.log('PASS v4 save-as links, compact/dark appearance, English controls, restart recovery of unsaved labels and backgrounds');
  } finally { await destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
