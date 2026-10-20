const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-boundary-'));
  const mapFile = path.join(dir, '边界拖动.mdmap');
  const item = (id, parent, text, extra = {}) => ({ id, parent, text, file: null, collapsed: false, ...extra });
  const originalOffset = { x: -800, y: -500 };
  await writeFile(mapFile, JSON.stringify({
    format: 'md-mindmap', version: 6, root: 'root', theme: 'rounded', lineStyle: 'orthogonal', connections: [],
    nodes: [
      item('root', null, '学习课程\n三天 · 六单元\n按步骤完成练习与展示', { offset: originalOffset }),
      ...Array.from({ length: 8 }, (_, i) => item('unit-' + i, 'root', `第 ${i + 1} 单元\n学习目标与练习`, { collapsed: true })),
    ],
  }));
  const app = await electron.launch({
    executablePath: process.env.MOYE_EXE || require('electron'),
    args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), mapFile, '--user-data-dir=' + path.join(dir, 'profile')],
    timeout: 30000,
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const root = page.locator('[data-node-id=root]');
    const canvas = page.locator('.mindmap-canvas');
    const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const save = async () => {
      await page.locator('#save').click(); await idle();
      await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden);
      return JSON.parse(await readFile(mapFile, 'utf8'));
    };
    const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1.5, `${label}: ${actual} vs ${expected}`);
    const positions = () => page.locator('[data-node-card]').evaluateAll(cards => Object.fromEntries(cards.map(card => {
      const rect = card.getBoundingClientRect();
      return [card.dataset.nodeCard, { x: rect.x, y: rect.y }];
    })));
    const startDrag = async (dx, dy) => {
      const rect = await root.boundingBox();
      assert.ok(await root.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'root drag must start on visible root text');
      await page.keyboard.down('Alt');
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy, { steps: 8 });
    };
    const finishDrag = async () => {
      await page.mouse.up(); await page.keyboard.up('Alt'); await settle();
    };
    const checkDisplacement = (before, after, dx, dy) => {
      for (const id of Object.keys(before)) {
        close(after[id].x - before[id].x, dx, id + ' screen x displacement');
        close(after[id].y - before[id].y, dy, id + ' screen y displacement');
      }
    };
    const checkTrunk = async () => {
      const trunks = await page.locator('.mindmap-branch').evaluateAll(lines => lines.map(line => {
        const points = line.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
        const verticals = [];
        for (let i = 2; i < points.length; i += 2) {
          if (points[i] === points[i - 2] && points[i + 1] !== points[i - 1]) verticals.push(points[i]);
        }
        return verticals;
      }));
      assert.equal(trunks.length, 8);
      assert.ok(trunks.every(values => values.length === 1), 'each sibling uses one vertical trunk');
      assert.equal(new Set(trunks.flat().map(value => value.toFixed(3))).size, 1, 'aligned siblings share a single trunk');
    };
    await root.waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1200, 1000); window.focus();
    });
    await page.waitForFunction(() => innerWidth === 1200);
    await page.getByRole('button', { name: '编辑', exact: true }).click(); await idle(); await settle();
    await root.scrollIntoViewIfNeeded(); await settle();
    await checkTrunk();
    let before = await positions();
    await startDrag(80, 0); await finishDrag();
    checkDisplacement(before, await positions(), 80, 0);
    let stored = await save();
    close(stored.nodes[0].offset.x, -720, 'first drag saves the actual pointer delta');
    await canvas.focus(); await page.keyboard.press('Control+z'); await settle();
    checkDisplacement(before, await positions(), 0, 0);
    await page.waitForTimeout(440); // Separate gestures from suppressed post-drag click.
    await root.scrollIntoViewIfNeeded(); await settle();
    before = await positions();
    await startDrag(-70, -60); await finishDrag();
    const moved = await positions();
    checkDisplacement(before, moved, -70, -60);
    stored = await save();
    close(stored.nodes[0].offset.x, -870, 'left boundary offset is saved');
    close(stored.nodes[0].offset.y, -560, 'top boundary offset is saved');
    await canvas.focus(); await page.keyboard.press('Control+z'); await settle();
    checkDisplacement(before, await positions(), 0, 0);
    await page.keyboard.press('Control+y'); await settle();
    checkDisplacement(moved, await positions(), 0, 0);
    await checkTrunk();
    // Recenter only the viewport so cancellation can start on a fully visible card.
    await page.getByRole('button', { name: '居中', exact: true }).click(); await settle();
    await page.waitForTimeout(440);
    before = await positions();
    await startDrag(-50, -40);
    await page.keyboard.press('Escape'); await finishDrag();
    checkDisplacement(before, await positions(), 0, 0);
    await save();
    await page.screenshot({ path: path.join(dir, 'boundary-and-aligned-lines.png') });
    await page.getByRole('button', { name: '关闭 边界拖动.mdmap', exact: true }).click(); await idle();
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, mapFile);
    await page.getByRole('button', { name: '打开', exact: true }).click(); await root.waitFor(); await idle();
    stored = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.deepEqual(stored.nodes[0].offset, { x: -870, y: -560 });
    await root.scrollIntoViewIfNeeded(); await settle();
    before = await positions();
    await startDrag(40, 30); await finishDrag();
    checkDisplacement(before, await positions(), 0, 0);
    assert.equal(await page.locator('#dirty-dot').isVisible(), false, 'reading mode does not modify root position');
    await checkTrunk();
    await page.getByRole('button', { name: '编辑', exact: true }).click(); await idle(); await settle();
    await page.locator('[data-node-card=root] .mindmap-fold').click(); await settle();
    assert.equal(await page.locator('[data-node-card]').count(), 1);
    await root.scrollIntoViewIfNeeded(); await settle();
    before = await positions();
    await startDrag(-45, -40); await finishDrag();
    checkDisplacement(before, await positions(), -45, -40);
    stored = await save();
    close(stored.nodes[0].offset.x, -915, 'collapsed map left boundary offset');
    close(stored.nodes[0].offset.y, -600, 'collapsed map top boundary offset');
    assert.deepEqual(errors, []);
    console.log('PASS root moves across top/left boundary; all descendants follow; first drag, undo/redo, cancel, save/reopen, read-only, collapsed map and aligned orthogonal trunks');
    console.log(dir);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
