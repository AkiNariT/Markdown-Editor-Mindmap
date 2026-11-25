const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

async function launch(file, profile) {
  const args = process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')];
  return electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...args, file, '--user-data-dir=' + profile] });
}
async function close(app) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
  await app.close();
}
function extractZip(zip, extracted) {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::ExtractToDirectory($env:MD_TEST_ARCHIVE, $env:MD_TEST_EXTRACT)"], {
      env: { ...process.env, MD_TEST_ARCHIVE: zip, MD_TEST_EXTRACT: extracted }, windowsHide: true,
    });
  } else execFileSync('unzip', ['-q', zip, '-d', extracted]);
}
async function run() {
  const parent = path.resolve(__dirname, '../.desktop-test');
  await fs.mkdir(parent, { recursive: true });
  const dir = await fs.mkdtemp(path.join(parent, 'share-'));
  const original = path.join(dir, '原设备');
  const extracted = path.join(dir, '另一台设备');
  const notes = path.join(original, '单独存放的文档');
  await fs.mkdir(notes, { recursive: true });
  await fs.mkdir(extracted);
  const note = path.join(notes, '规格.md');
  const image = path.join(original, '插图.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2QAAAAASUVORK5CYII=', 'base64');
  const diskText = '# 规格\n\n## 实施\n\n第一节\n\n## 实施\n\n![样图](../插图.png)\n\n## 补充\n';
  await fs.writeFile(note, diskText);
  await fs.writeFile(image, bytes);
  const map = path.join(original, '工作图.mdmap');
  const node = (id, parent, file = null) => ({ id, parent, text: id, file, collapsed: false });
  const { markdownToMindmap } = await import('../src/mindmap-outline.mjs');
  const { headingPath, headingAnchor } = markdownToMindmap(diskText, { file: note }).nodes[2];
  const section = { ...node('资料', '项目', note), offset: { x: 20, y: 10 }, subtitle: '设计备注', headingPath, headingAnchor };
  const legacy = { ...node('旧版定位', '项目', note), headingPath };
  const relation = { id: 'review', from: '资料', to: '新稿', label: '交叉引用', arrow: 'end' };
  const originalMap = JSON.stringify({ format: 'md-mindmap', version: 7, theme: 'classic', root: '项目',
    nodes: [node('项目', null), section, { ...node('新稿', '项目'), subtitle: '接收方练习' }, legacy], connections: [relation] });
  await fs.writeFile(map, originalMap);
  const zip = path.join(dir, '发送给同事.zip');
  let liveDraft;

  const app = await launch(map, path.join(dir, '首台配置'));
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
    const openNode = async id => { await page.locator('[data-node-id="' + id + '"]').dblclick(); await page.locator('.tiptap').waitFor(); await idle(); };
    const goBack = async () => { await page.getByRole('tab', { name: '工作图.mdmap', exact: true }).click(); await idle(); };
    const share = async () => { await page.locator('#more-toggle').click(); await page.locator('#share-project').click(); await idle(); };
    await app.evaluate(({ dialog }, filename) => {
      globalThis.shareSaves = 0;
      globalThis.shareWarnings = [];
      dialog.showSaveDialog = async () => { globalThis.shareSaves++; return { filePath: filename, canceled: false }; };
      dialog.showMessageBox = async (_win, options) => { globalThis.shareWarnings.push(options); return { response: options.cancelId }; };
    }, zip);
    await openNode('旧版定位');
    await page.locator('#heading-options').selectOption('2');
    await page.locator('#heading-open').click();
    await goBack(); await openNode('资料');
    await page.waitForFunction(() => CSS.highlights.get('md-linked-heading')?.values().next().value?.startContainer === document.querySelectorAll('.tiptap h2')[1]);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const source = page.locator('.source-input');
    await source.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n尚未保存的修订\n');
    await goBack();
    await openNode('新稿');
    const draft = page.locator('.tiptap[contenteditable=true]');
    assert.equal(await draft.locator('h1').textContent(), '新稿');
    const body = draft.locator('h1 + p');
    await body.click(); await page.keyboard.insertText('草稿中的正文');
    assert.equal(await body.textContent(), '草稿中的正文');
    assert.equal(await draft.locator('h1').textContent(), '新稿');
    liveDraft = await draft.evaluate(node => node.editor.getMarkdown().replace(/\n*$/, '') + '\n');
    await goBack();
    await share();
    assert.equal(await app.evaluate(() => globalThis.shareSaves), 1);
    assert.ok((await fs.stat(zip)).size > 0);
    assert.equal(await fs.readFile(note, 'utf8'), diskText);
    assert.equal(await fs.readFile(map, 'utf8'), originalMap);
    await fs.unlink(image);
    await share();
    assert.equal(await app.evaluate(() => globalThis.shareSaves), 1, '资源缺失时先核对，取消不会写包');
    assert.match(await app.evaluate(() => globalThis.shareWarnings.at(-1).detail), /插图/);
  } finally { await close(app); }

  extractZip(zip, extracted);
  await fs.rename(original, path.join(dir, '原位置已停用'));
  const entry = path.join(extracted, '工作图.mdmap');
  const packagedMap = JSON.parse(await fs.readFile(entry, 'utf8'));
  assert.ok(packagedMap.nodes.filter(n => n.file).every(n => !path.isAbsolute(n.file)));
  const draftFile = packagedMap.nodes.find(n => n.id === '新稿').file;
  assert.equal(await fs.readFile(path.join(extracted, draftFile), 'utf8'), liveDraft, 'ZIP 中的新稿必须保留导出前的完整编辑内容与段落结构');
  const bundledSection = packagedMap.nodes.find(n => n.id === '资料');
  for (const field of ['headingPath', 'offset', 'subtitle']) assert.deepEqual(bundledSection[field], section[field]);
  assert.deepEqual(packagedMap.connections[0], relation);
  const second = await launch(entry, path.join(dir, '全新配置'));
  try {
    const page = await second.firstWindow();
    await page.locator('[data-node-id="资料"]').dblclick();
    await page.waitForFunction(() => {
      const [range] = CSS.highlights.get('md-linked-heading') || [];
      return range?.startContainer === document.querySelectorAll('.tiptap h2')[1];
    });
    assert.equal(await page.locator('#heading-choice').isVisible(), false);
    await page.getByText('尚未保存的修订', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.tiptap img[alt="样图"]')?.naturalWidth === 1);
    const markdownZip = path.join(dir, '单篇.zip'), standalone = path.join(dir, '单篇解压');
    await second.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, markdownZip);
    await page.locator('#more-toggle').click();
    await page.locator('#share-project').click();
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    await fs.mkdir(standalone);
    extractZip(markdownZip, standalone);
    const text = await fs.readFile(path.join(standalone, '规格.md'), 'utf8');
    const { imageDestinations } = await import('../src/images.mjs');
    assert.deepEqual(await fs.readFile(path.join(standalone, decodeURIComponent(imageDestinations(text)[0]))), bytes);
    assert.match(text, /尚未保存的修订/);
    const back = page.getByRole('button', { name: '返回来源节点', exact: true });
    await back.click();
    await page.locator('[data-node-id="资料"][aria-pressed="true"]').waitFor();
    await page.locator('[data-node-card="项目"] .mindmap-fold').click();
    assert.equal(await page.locator('[data-node-id="新稿"]').count(), 0);
    await page.keyboard.press('Control+f');
    await page.locator('#find-query').fill('接收方练习');
    await page.locator('[data-node-id="新稿"][aria-pressed="true"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-node-id="新稿"]').dblclick();
    await page.locator('.tiptap h1').filter({ hasText: /^新稿$/ }).waitFor();
    await page.locator('.tiptap > p').filter({ hasText: /^草稿中的正文$/ }).waitFor();
    await back.click();
    await page.locator('[data-node-id="新稿"][aria-pressed="true"]').waitFor();
    assert.equal(await page.locator('#dirty-dot').isVisible(), false, '阅读、查找和返回应保留已保存状态');
  } finally { await close(second); }
  console.log('PASS: ZIP preserves linked changes, pending node draft and offline images under a fresh profile. Missing resources can cancel export.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
