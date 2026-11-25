const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const dir = path.resolve(__dirname, '../.desktop-test/mindmap-heading-' + Date.now());
  await mkdir(dir, { recursive: true });
  const note = path.join(dir, 'book.md'), mapFile = path.join(dir, 'book.mdmap');
  const filler = Array.from({ length: 30 }, (_, i) => 'Paragraph ' + i + '.').join('\n\n');
  const original = '# Book\n\n## A\n\n### Details\n\nFirst marker\n\n' + filler +
    '\n\n## B\n\n### Details\n\nSecond marker\n\n' + filler + '\n\n### Details\n\nThird marker\n\n' + filler + '\n';
  await writeFile(note, original);
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'),
    args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), note, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(), errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
    const active = async name => {
      await page.waitForFunction(name => document.querySelector('#document-name').textContent === name, name); await idle();
    };
    const back = async () => { await page.getByRole('tab', { name: 'book.mdmap', exact: true }).click(); await active('book.mdmap'); };
    const star = () => page.locator('[data-open-node="heading-5"]').click();
    const targetVisible = () => page.waitForFunction(() => {
      const highlight = CSS.highlights.get('md-linked-heading');
      const element = highlight?.values().next().value?.startContainer;
      if (element?.nextElementSibling?.textContent !== 'Third marker') return false;
      const rect = element.getBoundingClientRect(), canvas = document.querySelector('.canvas').getBoundingClientRect();
      return rect.top >= canvas.top && rect.bottom <= canvas.bottom;
    });
    await active('book.md'); await page.locator('#outline-to-mindmap').click();
    await page.locator('[data-node-id="heading-5"]').waitFor(); await idle();
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ filePath, canceled: false });
      dialog.showOpenDialog = async () => ({ filePaths: [filePath], canceled: false });
    }, mapFile);
    await page.locator('#save').click(); await active('book.mdmap');
    const stored = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.equal(stored.version, 7); assert.equal(stored.nodes.at(-1).file, 'book.md');
    await page.getByRole('button', { name: '关闭 book.mdmap', exact: true }).click(); await active('book.md');
    await page.locator('#open').click(); await active('book.mdmap');
    await page.getByRole('button', { name: '关闭 book.md', exact: true }).click(); await idle();
    await page.locator('[data-node-id="heading-5"]').dblclick(); await active('book.md'); await targetVisible();
    await page.waitForFunction(() => !CSS.highlights.has('md-linked-heading'));
    await page.getByRole('button', { name: '源码', exact: true }).click(); await idle();
    await page.getByRole('button', { name: '编辑', exact: true }).click(); await idle();
    const source = page.locator('.source-input');
    const edited = original.replace('## B', '## B\n\n### Details\n\nUnsaved marker');
    await source.fill(edited); await source.evaluate(input => { input.setSelectionRange(1, 3); input.scrollTop = 0; });
    await back(); await star(); await active('book.md');
    await page.locator('.source-linked-heading').waitFor();
    const targetLine = edited.slice(0, edited.lastIndexOf('### Details')).split('\n').length - 1;
    assert.ok(await source.evaluate((input, line) => {
      const marker = document.querySelector('.source-linked-heading'), style = getComputedStyle(input);
      const pixel = marker.offsetTop + input.scrollTop - parseFloat(style.paddingTop);
      return Math.abs(pixel - line * parseFloat(style.lineHeight)) < 2 && marker.offsetTop >= 0 && marker.offsetTop < input.clientHeight &&
        input.selectionStart === 1 && input.selectionEnd === 3;
    }, targetLine), 'source view highlights the intended current line and preserves the selection');
    assert.equal(await source.inputValue(), edited);
    await page.getByRole('button', { name: '对照', exact: true }).click(); await idle();
    await back(); await star(); await active('book.md'); await targetVisible(); await page.locator('.source-linked-heading').waitFor();
    await source.fill(edited.replace('### Details\n\nThird marker', '### Renamed\n\nThird marker'));
    await back(); await star(); await active('book.md');
    const chooser = page.locator('#heading-choice');
    await chooser.waitFor();
    assert.equal(await page.locator('.source-linked-heading').count(), 0);
    await chooser.getByRole('button', { name: '取消' }).click();
    await back(); await star(); await active('book.md'); await chooser.waitFor();
    const renamed = await page.locator('#heading-options option').filter({ hasText: 'Renamed' }).getAttribute('value');
    await page.locator('#heading-options').selectOption(renamed);
    await page.locator('#heading-rebind').click(); await targetVisible();
    await back(); await page.locator('#save').click(); await idle();
    const rebound = JSON.parse(await readFile(mapFile, 'utf8')).nodes.at(-1);
    assert.equal(rebound.headingPath.at(-1).text, 'Renamed');
    assert.ok(rebound.headingAnchor);
    await page.getByRole('button', { name: '关闭 book.mdmap', exact: true }).click(); await active('book.md');
    await page.locator('#open').click(); await active('book.mdmap'); await star(); await active('book.md'); await targetVisible();
    assert.equal(await chooser.isVisible(), false);
    assert.equal(await page.getByRole('tab').count(), 2);
    assert.equal(await readFile(note, 'utf8'), original);
    const oversized = await page.evaluate(async () => {
      const text = '章'.repeat(500);
      const ancestorHeadings = [1, 2, 3, 4, 5].map(depth => '#'.repeat(depth) + ' ' + text);
      const leaves = Array(900).fill('###### ' + text);
      return window.moye.mindmapFromOutline((await window.moye.ready()).id, ancestorHeadings.concat(leaves).join('\n'));
    });
    assert.match(oversized.error, /8 MB/);
    assert.equal(await page.getByRole('tab').count(), 2, 'oversized path data must not create an unsavable tab');
    assert.deepEqual(errors, []);
    console.log('PASS heading links after saving/reopening, inserted duplicates, all three views, unsaved edits, canceling an ambiguous link, and durable relinking after a rename');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
