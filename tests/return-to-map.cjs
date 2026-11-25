const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir, mkdtemp, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const base = path.join(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'map-return-'));
  const note = path.join(dir, 'article.md'), mapA = path.join(dir, 'first.mdmap'), mapB = path.join(dir, 'second.mdmap');
  const original = '# Article\n\n## Details\n\nOriginal text.\n';
  const node = (id, parent = 'root', file = note) => ({ id, parent, text: id, collapsed: false, file });
  const heading = { ...node('section'), headingPath: [{ level: 1, text: 'Article', occurrence: 1 }, { level: 2, text: 'Details', occurrence: 1 }] };
  const mapText = nodes => JSON.stringify({ format: 'md-mindmap', version: 7, root: 'root', nodes: [node('root', null, null), ...nodes], connections: [] });
  await writeFile(note, original);
  await writeFile(mapA, mapText([node('linked'), heading, node('draft', 'root', null)]));
  await writeFile(mapB, mapText([node('linked')]));
  const args = process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')];
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...args, note, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 60000 });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000);
    const back = page.getByRole('button', { name: '返回来源节点', exact: true });
    const active = async name => page.waitForFunction(name => document.querySelector('#document-name').textContent === name && !document.querySelector('#save').disabled, name);
    const tab = async name => { await page.getByRole('tab', { name, exact: true }).click(); await active(name); };
    const open = async file => {
      await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);
      await page.locator('#open').click(); await active(path.basename(file));
    };
    const from = async (id, name = 'article.md') => { await page.locator('[data-node-id="' + id + '"]').dblclick(); await active(name); };
    const verifyReturn = async (name, id) => {
      await back.click(); await active(name);
      await page.waitForFunction(id => document.querySelector('[data-node-id="' + id + '"]')?.getAttribute('aria-pressed') === 'true' && document.activeElement?.classList.contains('mindmap-canvas'), id);
    };
    await active('article.md'); assert.equal(await back.count(), 0);
    await page.locator('#mode').click(); await page.locator('.tiptap > p').last().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' retained');
    await open(mapA); await from('linked'); assert.equal(await page.getByRole('tab').count(), 2);
    assert.equal(await back.count(), 1, 'opening through an ordinary link exposes a return on the reused article');
    assert.match(await page.locator('.tiptap').textContent(), /retained/);
    await tab('first.mdmap'); await page.locator('[data-node-id=root]').click(); await tab('article.md');
    await verifyReturn('first.mdmap', 'linked');
    await from('section'); await page.waitForFunction(() => CSS.highlights.has('md-linked-heading'));
    await verifyReturn('first.mdmap', 'section');
    await from('draft', 'draft.md'); await page.locator('.tiptap h1 + p').click(); await page.keyboard.insertText('unsaved draft');
    await verifyReturn('first.mdmap', 'draft');
    const savedDraft = path.join(dir, 'named.md');
    await assert.rejects(readFile(path.join(dir, 'draft.md')), { code: 'ENOENT' });
    await from('draft', 'draft.md'); assert.match(await page.locator('.tiptap').textContent(), /unsaved draft/);
    await page.locator('#more-toggle').click(); await page.locator('#settings').click();
    await page.locator('#language-select').selectOption('en'); await page.keyboard.press('Escape');
    const english = page.getByRole('button', { name: 'Return to source node', exact: true }); await english.waitFor();
    assert.match(await english.getAttribute('title'), /first\.mdmap/);
    await page.locator('#more-toggle').click(); await page.locator('#settings').click();
    await page.locator('#language-select').selectOption('zh-CN'); await page.keyboard.press('Escape'); await back.waitFor();
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, savedDraft);
    await page.locator('#save').click(); await active('named.md');
    await verifyReturn('first.mdmap', 'draft');
    assert.match(await readFile(savedDraft, 'utf8'), /unsaved draft/);
    await open(mapB); await from('linked'); await verifyReturn('second.mdmap', 'linked');
    await from('linked'); await page.getByRole('button', { name: '关闭 second.mdmap', exact: true }).click();
    await active('article.md'); assert.equal(await back.count(), 0, 'closing the source map removes its return');
    await tab('first.mdmap'); await from('linked'); await open(note);
    assert.equal(await back.count(), 0, 'directly opening the same file does not invent a map origin');
    await tab('first.mdmap'); await page.locator('#mode').click(); await page.locator('[data-node-id=draft]').click();
    await page.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await tab('named.md'); assert.equal(await back.count(), 0, 'a removed node cannot redirect to the root or another map');
    assert.match(await page.locator('.tiptap').textContent(), /unsaved draft/);
    assert.equal(await readFile(note, 'utf8'), original);
    assert.deepEqual(errors, []);
    console.log('PASS return to the originating map node across links, headings, reused articles, unsaved drafts, direct opens and removed origins');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
