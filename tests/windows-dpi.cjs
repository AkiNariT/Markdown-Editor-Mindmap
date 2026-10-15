const { _electron: electron } = require('playwright');
const { mkdir, mkdtemp, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'windows-dpi-'));
  const file = path.join(dir, '中文 DPI 与缩放.md');
  const original = '# Windows DPI 与缩放\n\n' + Array.from({ length: 50 }, (_, i) => `## 段落 ${i + 1}\n\n中文、English 和文件路径在不同显示倍率下应可读。\n\n`).join('');
  await writeFile(file, original);
  const mapFile = path.join(dir, '缩放 导图.mdmap');
  const node = (id, parent, text) => ({ id, parent, text, file: null, collapsed: false });
  await writeFile(mapFile, JSON.stringify({ format: 'md-mindmap', version: 1, root: 'root', nodes: [node('root', null, 'DPI 主题'), node('branch', 'root', '可拖动分支'), node('leaf', 'branch', '子主题')] }));
  for (const scale of [1, 1.25, 1.5, 2]) {
    const profile = path.join(dir, `profile-${scale}`);
    const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), file, '--user-data-dir=' + profile, '--force-device-scale-factor=' + scale], timeout: 30000 });
    let page;
    try {
      page = await app.firstWindow(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.locator('.tiptap h1').waitFor();
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
      const size = async (width, height) => {
        await app.evaluate(({ BrowserWindow }, value) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(1, 1); window.setContentSize(value.width, value.height); }, { width, height });
        await page.waitForFunction(value => Math.abs(innerWidth - value.width) < 2 && Math.abs(innerHeight - value.height) < 2, { width, height }); await settle();
      };
      const checkShell = async label => {
        const geometry = await page.evaluate(() => {
          const ids = ['new', 'open', 'skill-template', 'new-mindmap', 'save', 'mode', 'more-toggle', 'zoom-out', 'zoom-reset', 'zoom-in'];
          const controls = ids.map(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(); return { id, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
          return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, controls };
        });
        assert.equal(geometry.scrollWidth, geometry.width, `${scale} ${label}: no whole-window horizontal overflow`);
        for (const r of geometry.controls) assert.ok(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.right <= geometry.width + 1 && r.bottom <= geometry.height + 1, `${scale} ${label}: control clipped ${JSON.stringify(r)} ${JSON.stringify(geometry)}`);
        for (let i = 0; i < geometry.controls.length; i++) for (let j = i + 1; j < geometry.controls.length; j++) {
          const a = geometry.controls[i], b = geometry.controls[j];
          assert.ok(Math.min(a.right, b.right) - Math.max(a.x, b.x) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) <= 1, `${scale} ${label}: overlapping ${a.id}/${b.id}`);
        }
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1, 'document zoom does not zoom application chrome');
      };
      const actualScale = await page.evaluate(() => devicePixelRatio);
      assert.ok(Math.abs(actualScale - scale) < .02, `requested scale ${scale}, actual ${actualScale}`);
      await size(1000, 720); await checkShell('Markdown 1000x720');
      const headingHeight = () => page.locator('.tiptap h1').evaluate(el => el.getBoundingClientRect().height);
      const beforeHeight = await headingHeight();
      const barHeight = await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().height);
      await page.keyboard.press('Control+='); await page.keyboard.press('Control+='); await settle();
      assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
      assert.ok(await headingHeight() > beforeHeight * 1.15);
      assert.equal(await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().height), barHeight);
      await page.locator('[data-view="compare"]').click(); await idle();
      assert.ok(Math.abs(await page.locator('.source-input').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) - 16.8) < .15);
      await size(640, 420); await checkShell('compare 640x420');
      const compare = await page.evaluate(() => { const source = document.querySelector('#source-container').getBoundingClientRect(), preview = document.querySelector('.canvas').getBoundingClientRect(), bar = document.querySelector('.page-bar').getBoundingClientRect(); return { sourceTop: source.top, sourceBottom: source.bottom, sourceHeight: source.height, previewTop: preview.top, previewHeight: preview.height, barBottom: bar.bottom }; });
      assert.ok(compare.sourceHeight > 40 && compare.previewHeight > 40 && compare.sourceTop >= compare.barBottom - 1 && compare.previewTop >= compare.sourceBottom - 1, `${scale} small compare panes usable: ${JSON.stringify(compare)}`);
      await page.screenshot({ path: path.join(dir, `scale-${scale}-small-compare.png`) });
      await size(1000, 720);
      await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, mapFile);
      await page.locator('#open').click(); await page.locator('[data-node-id="root"]').waitFor(); await idle(); await settle();
      assert.equal(await page.locator('.mindmap-toolbar button:visible').count(), 1);
      assert.equal(await page.locator('.mindmap-editor-row').isVisible(), false);
      await checkShell('mind map read');
      await page.locator('#mode').click(); await idle(); await settle();
      assert.equal(await page.locator('.mindmap-toolbar button:visible').count(), 8);
      assert.equal(await page.locator('.mindmap-editor-row').isVisible(), true);
      await page.keyboard.press('Control+='); await page.keyboard.press('Control+='); await settle();
      assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
      const branch = page.locator('[data-node-id="branch"]');
      await branch.scrollIntoViewIfNeeded(); await settle();
      const position = () => branch.evaluate(el => ({ x: parseFloat(el.closest('.mindmap-node').style.left), y: parseFloat(el.closest('.mindmap-node').style.top) }));
      const before = await position(), rect = await branch.boundingBox();
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      assert.equal(await branch.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point), true, 'drag starts on the visible node');
      await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x - 60, point.y + 24, { steps: 8 }); await page.mouse.up(); await settle();
      const moved = await position();
      assert.ok(Math.abs(moved.x - before.x + 50) < 2 && Math.abs(moved.y - before.y - 20) < 2, `${scale}: DPI-independent 120% drag ${JSON.stringify({ before, moved })}`);
      await page.keyboard.press('Control+z'); await settle();
      const undone = await position(); assert.ok(Math.abs(undone.x - before.x) < 1 && Math.abs(undone.y - before.y) < 1);
      await size(640, 420); await checkShell('mind map edit 640x420');
      const mapGeometry = await page.locator('.mindmap-canvas').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight, top: el.getBoundingClientRect().top }));
      assert.ok(mapGeometry.width > 200 && mapGeometry.height > 60, `small map remains usable: ${JSON.stringify(mapGeometry)}`);
      await page.screenshot({ path: path.join(dir, `scale-${scale}-small-map.png`) });
      await page.locator('#mode').click(); await idle(); await settle();
      assert.equal(await page.locator('.mindmap-toolbar button:visible').count(), 1);
      await checkShell('mind map read 640x420');
      assert.equal(await readFile(file, 'utf8'), original, 'DPI and zoom do not change document bytes');
      assert.deepEqual(errors, []);
      console.log(`WINDOWS DPI PASS: scale ${scale}, actual ${actualScale}, 1000x720 and 640x420, Markdown/source/map/zoom/drag`);
    } catch (error) {
      if (page) await page.screenshot({ path: path.join(dir, `scale-${scale}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
      await app.close().catch(() => {});
    }
  }
  console.log('WINDOWS DPI SCREENSHOTS: ' + dir);
})().catch(error => { console.error(error); process.exitCode = 1; });
