const { _electron: electron } = require('playwright');
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..'), base = path.join(root, '.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'document-find-'));
  const file = path.join(dir, '查找.md'), other = path.join(dir, '另一份.md');
  const original = ['# First', '', '中**文** Alpha', '', ...Array.from({ length: 70 }, (_, i) => 'Paragraph ' + i + '\n'),
    '中文 ALPHA', '', '[link](https://example.test/source-only)', ''].join('\n');
  await writeFile(file, original); await writeFile(other, '# Other\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const app = await electron.launch({ executablePath, args: [...(process.env.MOYE_EXE ? [] : [root]), file, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    const bar = page.locator('#find-bar'), query = page.locator('#find-query'), count = page.locator('#find-count');
    const source = page.locator('.source-input:visible'), canvas = page.locator('.canvas');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function search(text) {
      await page.keyboard.press('Control+f'); await query.fill(text);
      assert.ok(await query.evaluate(input => input === document.activeElement));
    }
    async function expectCount(value) { await page.waitForFunction(text => document.querySelector('#find-count').textContent === text, value); }
    async function switchView(view) { await page.locator('[data-view="' + view + '"]').click(); }

    await page.locator('.tiptap h1').waitFor();
    await canvas.focus();
    await search('中文'); await expectCount('1 / 2');
    const highlighted = () => page.evaluate(() => [...CSS.highlights.get('document-find-active')][0].toString());
    assert.equal(await highlighted(), '中文');
    await query.press('Enter'); await expectCount('2 / 2');
    assert.ok(await canvas.evaluate(node => node.scrollTop > 100));
    await query.press('Enter'); await expectCount('1 / 2');
    await query.press('Shift+Enter'); await expectCount('2 / 2');
    await query.fill('missing'); await expectCount('无匹配');
    assert.equal(await page.locator('#find-next').isDisabled(), true);
    await query.press('Escape'); await bar.waitFor({ state: 'hidden' });
    assert.equal(await canvas.evaluate(node => node.scrollTop), 0);
    assert.ok(await canvas.evaluate(node => node === document.activeElement));
    assert.equal(await page.evaluate(() => CSS.highlights.has('document-find-active')), false);

    await switchView('source'); await source.focus();
    await source.evaluate(node => { node.setSelectionRange(2, 4, 'backward'); node.scrollTop = 240; });
    await search('SOURCE-ONLY'); await expectCount('1 / 1');
    assert.equal(await page.locator('.find-source-line mark').textContent(), 'source-only');
    assert.ok(await source.evaluate(node => node.scrollTop > 100));
    async function aligned() {
      await page.waitForFunction(() => {
        const input = document.querySelector('.source-input'), line = document.querySelector('.find-source-line');
        if (!line) return false;
        const style = getComputedStyle(input), hitLine = input.value.slice(0, input.value.indexOf('source-only')).split('\n').length - 1;
        const top = parseFloat(style.paddingTop) + hitLine * parseFloat(style.lineHeight) - input.scrollTop;
        const inputRect = input.getBoundingClientRect(), rect = line.getBoundingClientRect();
        return Math.abs(rect.top - inputRect.top - top) < 2 && getComputedStyle(line).fontSize === style.fontSize &&
          Math.abs(line.parentElement.getBoundingClientRect().width - input.clientWidth) < 1 &&
          rect.bottom > inputRect.top && rect.top < inputRect.bottom;
      }, null, { timeout: 3000 });
    }
    await aligned();
    await page.locator('#zoom-in').click();
    await page.waitForFunction(() => document.querySelector('#zoom-reset').textContent === '110%');
    await aligned();
    await source.hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -110); await page.keyboard.up('Control');
    await page.waitForFunction(() => document.querySelector('#zoom-reset').textContent === '120%');
    await aligned();
    const resizedWidth = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0], [width, height] = window.getContentSize();
      const next = width > 880 ? 760 : 1060;
      window.setContentSize(next, height); return next;
    });
    await page.waitForFunction(width => innerWidth === width, resizedWidth);
    await aligned();
    await query.press('Escape');
    assert.deepEqual(await source.evaluate(node => [node.selectionStart, node.selectionEnd, node.selectionDirection, node.scrollTop, node === document.activeElement]), [2, 4, 'backward', 288, true]);
    assert.equal(await source.inputValue(), original);

    await switchView('compare'); await source.focus();
    await search('source-only'); await expectCount('1 / 1');
    assert.equal(await page.locator('#find-scope').textContent(), '源码');
    await query.press('Escape'); await canvas.focus();
    await search('source-only'); await expectCount('无匹配');
    assert.equal(await page.locator('#find-scope').textContent(), '正文');
    await query.press('Escape');

    await switchView('render'); await page.locator('#mode').click();
    const visual = page.locator('.tiptap'); await visual.locator('h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText('!');
    const selectionBefore = await visual.evaluate(node => node.editor.state.selection.toJSON());
    await search('alpha'); await expectCount('1 / 2'); await query.press('Enter'); await query.press('Escape');
    assert.deepEqual(await visual.evaluate(node => node.editor.state.selection.toJSON()), selectionBefore);
    await page.keyboard.press('Control+z');
    assert.equal(await visual.locator('h1').textContent(), 'First');
    assert.equal(await readFile(file, 'utf8'), original);

    await page.locator('#more-toggle').click(); await page.locator('#find-open').click(); await query.fill('alpha'); await expectCount('1 / 2');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, other);
    await page.locator('#open').click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '另一份.md');
    await bar.waitFor({ state: 'hidden' }); await search('alpha'); await expectCount('无匹配');
    await query.press('Escape'); await page.locator('#more-toggle').click(); await page.locator('#settings').click();
    await page.locator('#settings-dialog[open]').waitFor(); await page.keyboard.press('Control+f');
    assert.equal(await bar.isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS document find: rendered and source text, both compare panes, count, wrapping, focus, selection, scroll, undo, tab isolation and modal ownership.');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); }).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
