const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir, mkdtemp } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const parent = path.resolve(__dirname, '../.desktop-test');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'recovery-map-'));
  const profile = path.join(dir, 'profile'), sessionFile = path.join(profile, 'session.json');
  const file = path.join(dir, '恢复脑图.mdmap'), note = path.join(dir, '关联笔记.md');
  const noteContent = '# 关联笔记\n\n从恢复后的星星与双击打开。\n';
  const node = (id, parent, text, linked = null) => ({ id, parent, text, file: linked, collapsed: false });
  const original = JSON.stringify({ format: 'md-mindmap', version: 1, root: 'root', nodes: [
    node('root', null, '制作计划'), node('first', 'root', '前期调研'), node('second', 'root', '故事方向'),
    node('linked', 'root', '待恢复节点', '关联笔记.md'), node('deep1', 'linked', '角色资料'), node('deep2', 'deep1', '角色关系'), node('deep3', 'deep2', '人物小传'),
    node('other', 'root', '场景设计'), node('fifth', 'root', '镜头规划'), node('sixth', 'root', '制作记录')
  ] }, null, 2) + '\n';
  await writeFile(file, original); await writeFile(note, noteContent);
  const errors = []; let app, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const linked = () => page.locator('[data-node-id="linked"]');
  const canvas = () => page.locator('.mindmap-canvas');
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const active = name => page.waitForFunction(value => document.querySelector('#document-name').textContent === value, name);
  async function launch(files = []) {
    app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...files, '--user-data-dir=' + profile], timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
    await page.waitForFunction(() => innerWidth === 1280 && Boolean(window.moye));
    await linked().waitFor(); await idle(); await settle();
  }
  async function waitSession(predicate, description) {
    const deadline = Date.now() + 15000; let latest;
    while (Date.now() < deadline) {
      try { latest = JSON.parse(await readFile(sessionFile, 'utf8')); if (predicate(latest)) return latest; }
      catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`等待脑图恢复记录超时：${description}\n${JSON.stringify(latest)}`);
  }
  async function crash() {
    const exiting = app.waitForEvent('close');
    await app.evaluate(() => { setTimeout(() => process.exit(0), 20); });
    await exiting; app = null;
  }
  const viewPosition = () => canvas().evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  const positions = () => page.locator('.mindmap-node').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.nodeCard, { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }])));
  async function backToMap() { await page.getByRole('tab', { name: '恢复脑图.mdmap', exact: true }).click(); await active('恢复脑图.mdmap'); await idle(); await settle(); }
  async function inNote() {
    await active('关联笔记.md'); await idle();
    assert.equal(await page.getByRole('tab').count(), 2, '关联文件始终复用同一标签');
    assert.equal(await page.locator('.tiptap h1').textContent(), '关联笔记');
  }
  try {
    await launch([file]); await active('恢复脑图.mdmap');
    await button('编辑').click(); await idle(); await linked().click();
    await page.getByRole('textbox', { name: '节点文字', exact: true }).fill('崩溃后恢复的节点');
    await page.getByRole('textbox', { name: '节点文字', exact: true }).blur();
    // Fixed palette applies text and background atomically.
    await page.locator('[data-palette=pink]').click();
    const before = await positions(), rect = await linked().boundingBox();
    await page.mouse.move(rect.x + 60, rect.y + 30); await page.mouse.down();
    await page.mouse.move(rect.x + 145, rect.y + 65, { steps: 8 }); await page.mouse.up();
    const editedPositions = await positions();
    assert.ok(Math.abs(editedPositions.linked.x - before.linked.x - 85) < 2);
    assert.ok(Math.abs(editedPositions.linked.y - before.linked.y - 35) < 2);
    await linked().click({ button: 'right' }); await page.locator('[data-action="connect"]').click(); await page.locator('[data-node-id="other"]').click();
    assert.equal(await page.locator('[data-connection-line]').count(), 1);
    await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
    await linked().click(); await canvas().focus();
    await canvas().evaluate(element => { element.scrollLeft = 360; element.scrollTop = 300; }); await settle();
    const panStart = await canvas().evaluate(element => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.top + 120; y < rect.bottom - 30; y += 70) for (let x = rect.left + 120; x < rect.right - 30; x += 70) {
        const target = document.elementFromPoint(x, y);
        if (element.contains(target) && !target.closest('button,input,[data-node-card],[data-connection-id]')) return { x, y };
      }
      throw new Error('夹具没有可拖动画布空白');
    });
    const beforePan = await viewPosition();
    await page.mouse.move(panStart.x, panStart.y); await page.mouse.down();
    await page.mouse.move(panStart.x - 65, panStart.y - 55, { steps: 8 }); await page.mouse.up(); await settle();
    const savedPosition = await viewPosition();
    const savedLayout = await positions();
    assert.ok(Math.abs(savedPosition.left - beforePan.left - 65) < 2 && Math.abs(savedPosition.top - beforePan.top - 55) < 2, '画布实际拖动产生双轴滚动');
    assert.ok(savedPosition.left > 0 && savedPosition.top > 0);
    assert.equal(await page.locator('[data-node-card="linked"]').evaluate(element => element.classList.contains('mindmap-selected')), true);
    const saved = await waitSession(value => {
      const record = value.documents?.find(item => item.path === file); if (!record?.draft) return false;
      const draft = JSON.parse(record.draft), linkedNode = draft.nodes.find(item => item.id === 'linked');
      return record.dirty && linkedNode.text === '崩溃后恢复的节点' && linkedNode.color === '#713d54'
        && linkedNode.offset?.x === 85 && linkedNode.offset?.y === 35 && draft.connections?.length === 1
        && record.viewState?.editing === true && record.viewState.zoom === 120 && record.viewState.map?.selected === 'linked'
        && Math.abs(record.viewState.map.position.left - savedPosition.left) < 2 && Math.abs(record.viewState.map.position.top - savedPosition.top) < 2
        && value.activeId === record.id;
    }, '节点草稿、文字颜色、布局连线、选中节点和画布位置已落盘');
    const savedRecord = saved.documents.find(item => item.path === file);
    assert.equal(savedRecord.content, original, '恢复记录保留原始脑图基线');
    assert.equal(await readFile(file, 'utf8'), original, '自动备份不会改动脑图原文件');
    await page.screenshot({ path: path.join(dir, 'before-process-exit.png') });
    await crash();

    await launch(); await active('恢复脑图.mdmap');
    assert.equal(await page.getByRole('tab').count(), 1);
    assert.equal(await linked().locator('.mindmap-node-title').textContent(), '崩溃后恢复的节点');
    assert.equal(await linked().locator('.mindmap-node-title').evaluate(element => getComputedStyle(element).color), 'rgb(113, 61, 84)');
    const restoredLayout = await positions();
    assert.equal(await page.locator('[data-connection-line]').count(), 1);
    assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
    assert.equal(await page.locator('[data-node-card="linked"]').evaluate(element => element.classList.contains('mindmap-selected')), true);
    assert.equal(await page.getByRole('textbox', { name: '节点文字', exact: true }).inputValue(), '崩溃后恢复的节点');
    assert.equal(await page.getByRole('textbox', { name: '节点文字', exact: true }).isEditable(), true);
    const restoredPosition = await viewPosition();
    assert.ok(Math.abs(restoredPosition.left - savedPosition.left) < 2 && Math.abs(restoredPosition.top - savedPosition.top) < 2,
      '画布视口恢复：' + JSON.stringify({ savedPosition, restoredPosition }));
    assert.equal(await page.locator('#dirty-dot').isVisible(), true);
    assert.equal(await readFile(file, 'utf8'), original);
    await waitSession(value => value.documents?.some(item => item.path === file && item.content === original && item.draft === savedRecord.draft), '恢复后的备份保持同一草稿与基线');
    const editScreenshot = path.join(dir, 'recovered-map-edit.png');
    await page.screenshot({ path: editScreenshot });

    await button('阅读').click(); await idle(); await settle();
    assert.equal(await page.getByRole('textbox', { name: '节点文字', exact: true }).isVisible(), false);
    assert.equal(await button('居中').isVisible(), true);
    const readScreenshot = path.join(dir, 'recovered-map-read.png');
    await page.screenshot({ path: readScreenshot });
    await page.locator('[data-open-node="linked"]').click(); await inNote();
    await backToMap();
    const parkedPosition = await viewPosition();
    assert.ok(parkedPosition.left > 0 && parkedPosition.top > 0, '隐藏标签测试必须从非零画布位置开始');
    await linked().dblclick(); await inNote();
    const hiddenCanvas = await canvas().evaluate(element => ({ connected: element.isConnected, width: element.clientWidth, height: element.clientHeight, left: element.scrollLeft, top: element.scrollTop }));
    console.log('HIDDEN MAP CANVAS', JSON.stringify({ parkedPosition, hiddenCanvas }));
    await button('源码').click(); await button('编辑').click(); await idle();
    const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true });
    for (const marker of ['HIDDEN_MAP_CHECKPOINT_ONE', 'HIDDEN_MAP_CHECKPOINT_TWO']) {
      const noteDraft = noteContent + '\n' + marker + '\n';
      await source.fill(noteDraft);
      const persisted = await waitSession(value => {
        const noteRecord = value.documents?.find(item => item.path === note);
        return value.activeId === noteRecord?.id && noteRecord.draft === noteDraft;
      }, 'Markdown 活动期间发生独立的持久化：' + marker);
      const mapPosition = persisted.documents.find(item => item.path === file)?.viewState?.map?.position;
      assert.ok(mapPosition && Math.abs(mapPosition.left - parkedPosition.left) < 2 && Math.abs(mapPosition.top - parkedPosition.top) < 2,
        '隐藏脑图的自动备份不能用零尺寸画布覆盖原位置：' + JSON.stringify({ marker, parkedPosition, mapPosition, hiddenCanvas }));
    }
    await backToMap();
    const returnedPosition = await viewPosition();
    assert.ok(Math.abs(returnedPosition.left - parkedPosition.left) < 2 && Math.abs(returnedPosition.top - parkedPosition.top) < 2,
      '经过两个隐藏期间的备份后切回脑图保留平移：' + JSON.stringify({ parkedPosition, returnedPosition }));
    await page.locator('[data-node-card="linked"]').dblclick({ position: { x: 3, y: 3 } }); await inNote();
    assert.equal(await readFile(file, 'utf8'), original, '恢复和打开关联文档均不写回源脑图');
    assert.equal(await readFile(note, 'utf8'), noteContent);
    assert.deepEqual(restoredLayout, savedLayout, '脑图手动布局与子节点位置在相同缩放下完整恢复');
    assert.deepEqual(errors, []);
    console.log('RECOVERY MAP PASS: process interruption, unsaved node text/palette/offset/connection, original baseline, selected node, editing state, zoom, canvas pan across two hidden-tab checkpoints and star/title/card opening.');
    console.log(JSON.stringify({ profile, editScreenshot, readScreenshot, savedPosition, restoredPosition }));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(dir, 'recovery-map-failure.png') }).catch(() => {});
      console.error('RECOVERY MAP FAILURE', await page.evaluate(() => ({ active: document.querySelector('#document-name')?.textContent,
        zoom: document.querySelector('#zoom-reset')?.textContent, toast: document.querySelector('#toast')?.textContent,
        selected: document.querySelector('.mindmap-selected')?.dataset.nodeCard,
        scroll: { left: document.querySelector('.mindmap-canvas')?.scrollLeft, top: document.querySelector('.mindmap-canvas')?.scrollTop },
      })).catch(() => null), 'profile:', profile);
    }
    throw error;
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
