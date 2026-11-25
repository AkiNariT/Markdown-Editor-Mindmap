const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const base = path.join(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'writing-'));
  const file = path.join(dir, 'first.md'), second = path.join(dir, 'new.md'), copy = path.join(dir, 'copy.md');
  await writeFile(file, 'before after');
  const args = process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')];
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'),
    args: [...args, file, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const visual = page.locator('.tiptap'), source = page.locator('.source-input:visible');
    const idle = () => page.waitForFunction(() => !document.getElementById('save').disabled);
    const focused = locator => locator.evaluate(n => document.activeElement === n);
    const text = () => visual.evaluate(node => node.editor.state.doc.textContent);
    const select = (from, to = from) => visual.evaluate((node, range) => {
      node.editor.commands.setTextSelection(range); node.editor.view.focus();
    }, { from, to });
    const saveTarget = async filePath => app.evaluate(({ dialog }, target) => {
      globalThis.saveDialogs = 0;
      dialog.showSaveDialog = async () => { globalThis.saveDialogs++; return { canceled: !target, filePath: target }; };
    }, filePath);
    await visual.waitFor(); await page.locator('#mode').click(); await idle();
    await select(7); await page.keyboard.insertText('!'); await page.keyboard.press('Control+s'); await idle();
    assert.equal(await focused(visual), true, 'ordinary save restores the writing surface');
    await page.keyboard.insertText('?'); assert.equal(await text(), 'before!? after');
    assert.equal((await readFile(file, 'utf8')).trim(), 'before! after');

    await select(1, 7); await saveTarget(null); await page.keyboard.press('Control+Shift+s'); await idle();
    assert.equal(await app.evaluate(() => globalThis.saveDialogs), 1, 'Save As opens once');
    assert.equal(await visual.locator('s').count(), 0, 'Save As cannot apply strikethrough');
    assert.deepEqual(await visual.evaluate(n => [n.editor.state.selection.anchor, n.editor.state.selection.head]), [1, 7]);
    assert.equal(await focused(visual), true);
    await saveTarget(copy); await page.keyboard.press('Control+Shift+s'); await idle();
    assert.equal((await readFile(copy, 'utf8')).trim(), 'before!? after');
    assert.deepEqual(await visual.evaluate(n => [n.editor.state.selection.anchor, n.editor.state.selection.head]), [1, 7]);
    await page.keyboard.press('Control+z'); assert.equal(await text(), 'before! after', 'Undo crosses Save As');
    await page.keyboard.press('Control+Shift+z'); assert.equal(await text(), 'before!? after');

    await page.keyboard.press('Control+n'); await page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2); await idle();
    await visual.focus(); await page.keyboard.insertText('draft');
    await saveTarget(second); await page.keyboard.press('Control+s'); await idle();
    assert.equal(await focused(visual), true); await page.keyboard.press('Control+z');
    assert.equal(await text(), '', 'first save retains the original undo history');
    await page.keyboard.press('Control+Shift+z'); assert.equal(await text(), 'draft');
    await page.locator('[data-view=compare]').click(); await idle(); await source.focus();
    await source.evaluate(n => n.setSelectionRange(2, 2)); await page.keyboard.insertText('X');
    await page.keyboard.press('Control+s'); await idle(); assert.equal(await focused(source), true);
    await page.keyboard.press('Control+Tab'); await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'copy.md'); await idle();
    assert.equal(await focused(visual), true, 'keyboard tab switching lands in the previous writing pane');
    await page.keyboard.press('Control+Shift+Tab'); await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'new.md'); await idle();
    assert.equal(await focused(source), true, 'the left comparison pane keeps keyboard focus');
    await page.keyboard.insertText('Y'); assert.match(await source.inputValue(), /drXYaft/);
    await page.locator('[data-view=source]').click(); await idle(); await source.focus();
    await source.evaluate(n => n.setSelectionRange(1, 3)); await page.locator('#save').click(); await idle();
    assert.equal(await focused(source), true, 'toolbar save returns to the source selection');
    assert.deepEqual(await source.evaluate(n => [n.selectionStart, n.selectionEnd]), [1, 3]);
    await saveTarget(null);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.press('Control+Shift+s');
    assert.equal(await app.evaluate(() => globalThis.saveDialogs), 0, 'an unfinished composition owns the shortcut');
    await cdp.send('Input.insertText', { text: '你' }); await cdp.detach();
    assert.match(await source.inputValue(), /你/);
    await page.locator('#rename').click(); await page.waitForSelector('#name-dialog[open]'); await saveTarget(null);
    await page.keyboard.press('Control+Shift+s'); assert.equal(await app.evaluate(() => globalThis.saveDialogs), 0, 'modal owns keyboard');
    await page.keyboard.press('Escape');

    const pictureFile = path.join(dir, 'picture.md'), folder = path.join(dir, 'copies');
    await mkdir(folder);
    await writeFile(path.join(dir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9AAAAABJRU5ErkJggg==', 'base64'));
    await writeFile(pictureFile, '![pixel](pixel.png)\n\ncaption');
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, pictureFile);
    await page.keyboard.press('Control+o'); await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'picture.md');
    await page.locator('#mode').click(); await idle(); await visual.locator('p').last().click();
    await page.keyboard.press('End'); await page.keyboard.insertText('A');
    await saveTarget(path.join(folder, 'picture-copy.md')); await page.keyboard.press('Control+Shift+s'); await idle();
    const imageLoaded = () => page.waitForFunction(() => document.querySelector('.tiptap img')?.naturalWidth === 1);
    await imageLoaded(); assert.match(await visual.evaluate(n => n.editor.getMarkdown()), /\.\.\/pixel\.png/);
    await page.keyboard.press('Control+z'); assert.equal(await text(), 'caption'); await imageLoaded();
    await page.keyboard.press('Control+Shift+z'); assert.equal(await text(), 'captionA');
    await page.locator('[data-view=source]').click(); await idle(); await source.focus(); await page.keyboard.press('Control+End');
    await page.keyboard.insertText('B'); await saveTarget(path.join(dir, 'picture-again.md')); await page.keyboard.press('Control+Shift+s'); await idle();
    await page.keyboard.press('Control+z'); assert.match(await source.inputValue(), /!\[pixel\]\(pixel\.png\)/);
    assert.doesNotMatch(await source.inputValue(), /B/); await page.keyboard.press('Control+Shift+z');
    assert.match(await source.inputValue(), /B/); assert.doesNotMatch(await source.inputValue(), /\.\.\/pixel\.png/);
    console.log('PASS writing continuity across save, first save, Save As, undo/redo, keyboard tab changes, composition and relocated images');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
