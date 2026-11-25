const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), base = path.join(root, '.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-find-'));
  const file = path.join(dir, '项目.mdmap'), other = path.join(dir, '说明.md');
  const node = (id, parent, text, extra) => ({ id, parent, text, file: null, collapsed: false, ...extra });
  const nodes = [node('root', null, '项目'), node('section', 'root', '章节', { collapsed: true }),
    node('one', 'section', 'Alpha 标题', { subtitle: '另一个 Alpha' }), node('two', 'root', '里程碑', { subtitle: 'alpha 备注' })];
  const original = JSON.stringify({ format: 'md-mindmap', version: 6, root: 'root', nodes, connections: [] });
  await writeFile(file, original); await writeFile(other, '# 说明\n');
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'),
    args: [...(process.env.MOYE_EXE ? [] : [root]), file, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    const bar = page.locator('#find-bar'), query = page.locator('#find-query');
    const card = id => page.locator('[data-node-id="' + id + '"]');
    const selected = id => page.waitForFunction(id => document.querySelector('[data-node-id="' + id + '"]')?.getAttribute('aria-pressed') === 'true', id);
    const count = text => page.waitForFunction(text => document.querySelector('#find-count').textContent === text, text);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await card('root').waitFor(); assert.equal(await card('one').count(), 0);
    await page.keyboard.press('Control+f'); await query.fill('ALPHA'); await count('1 / 2'); await selected('one');
    assert.ok(await query.evaluate(input => input === document.activeElement));
    await query.press('Enter'); await count('2 / 2'); await selected('two'); assert.equal(await card('one').count(), 0);
    await page.locator('#find-previous').click(); await selected('one'); await query.press('Escape');
    await bar.waitFor({ state: 'hidden' }); await selected('one');
    assert.ok(await page.locator('.mindmap-canvas').evaluate(canvas => canvas === document.activeElement));
    assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    await page.locator('#mode').click(); await page.locator('.mindmap-view:not(.mindmap-readonly):not(.mindmap-locked)').waitFor();
    assert.equal(await card('one').count(), 0);
    await page.locator('#more-toggle').click(); await page.locator('#find-open').click();
    await query.fill('备注'); await count('1 / 1'); await selected('two');
    await query.fill('没有这个节点'); await count('无匹配'); assert.ok(await page.locator('#find-next').isDisabled());
    await query.fill('标题'); await selected('one'); await page.locator('#find-close').click(); await selected('one');
    await page.keyboard.press('Control+z'); assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    await page.keyboard.press('Control+f'); await query.fill('alpha');
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, other);
    await page.locator('#open').click(); await page.locator('.tiptap h1').waitFor(); await bar.waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+f'); await query.fill('说明'); await count('1 / 1');
    assert.equal(await page.locator('#document-pane #find-bar').isVisible(), true);
    assert.equal(await readFile(file, 'utf8'), original); assert.deepEqual(errors, []);
    console.log('PASS map find: hidden descendants, title/notes, next/previous, focus, edit/read, undo, untouched file and document switching.');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
