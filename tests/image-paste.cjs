const { _electron: electron } = require('playwright');
const { mkdir, readFile, writeFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const directory = path.resolve(__dirname, '../.desktop-test/image-paste-' + Date.now());
  const profile = path.join(directory, 'profile');
  await mkdir(directory, { recursive: true });
  const fixture = path.join(directory, '原文.md');
  await writeFile(fixture, '# 原文\n\n原有文字。\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const project = path.resolve(__dirname, '..');
  let app, page;
  const errors = [];
  let beforeClipboard;
  const launch = async (files = []) => {
    app = await electron.launch({ executablePath, args: [...(process.env.MOYE_EXE ? [] : [project]), ...files, '--user-data-dir=' + profile], timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap');
    await page.waitForFunction(() => !document.querySelector('#new').disabled);
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  };
  const idle = () => page.waitForFunction(() => !document.querySelector('#new').disabled);
  const images = async count => {
    await page.waitForFunction(expected => {
      const images = [...document.querySelectorAll('.tiptap figure img')];
      return images.length === expected && images.every(image => image.complete && image.naturalWidth > 0);
    }, count);
    await idle();
  };
  const view = async name => { await page.getByRole('button', { name, exact: true }).click(); await idle(); };
  const source = () => page.locator('.source-input');
  const waitRecovery = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const value = JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')); if (predicate(value)) return value; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Recovery checkpoint did not contain the pasted image');
  };
  const pasteScreenshot = async () => {
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const image = nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 180), { width: 8, height: 8 });
      if (image.isEmpty()) throw new Error('Invalid image fixture');
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    });
    await page.keyboard.press('Control+v');
  };
  const restoreClipboard = async () => {
    if (!beforeClipboard) return;
    await app.evaluate(async ({ clipboard, ClipboardItem }, values) => {
      if (!values.length) { clipboard.clear(); return; }
      await clipboard.write(values.map(value => new ClipboardItem(Object.fromEntries(Object.entries(value).map(([type, payload]) => [type, payload.bookmark || new Blob([Buffer.from(payload.bytes, 'base64')], { type })])))));
    }, beforeClipboard);
  };
  const dropImages = async count => {
    const bytes = await app.evaluate(({ nativeImage }) => [...nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 140), { width: 8, height: 8 }).toPNG()]);
    await page.locator('.tiptap > p').last().evaluate((element, { bytes, count }) => {
      const transfer = new DataTransfer();
      for (let index = 0; index < count; index++) transfer.items.add(new File([new Uint8Array(bytes)], `拖入${index + 1}.png`, { type: 'image/png' }));
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 10, clientY: rect.top + rect.height / 2 }));
    }, { bytes, count });
  };
  try {
    await launch([fixture]);
    // Preserve every advertised format only in memory, never in test logs.
    beforeClipboard = await app.evaluate(async ({ clipboard }) => Promise.all((await clipboard.read()).map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => {
      const value = await item.getType(type);
      return [type, type === 'electron application/bookmark' ? { bookmark: value } : { bytes: Buffer.from(await value.arrayBuffer()).toString('base64') }];
    }))))));
    await page.locator('.tiptap').click();
    await pasteScreenshot();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.tiptap img').count(), 0, 'Reading mode must not insert clipboard images');
    assert.equal(await readFile(fixture, 'utf8'), '# 原文\n\n原有文字。\n');

    await page.locator('#new').click(); await idle();
    await page.locator('.tiptap').click(); await page.keyboard.insertText('草稿中的截图');
    await page.keyboard.press('Enter');
    await pasteScreenshot();
    await images(1);
    assert.match(await page.locator('.tiptap').textContent(), /草稿中的截图/);
    console.log('PASS actual Windows clipboard Ctrl+V into an unsaved draft');
    await page.keyboard.press('Control+z'); await images(0);
    assert.match(await page.locator('.tiptap').textContent(), /草稿中的截图/, 'Undo removes the image without deleting previous typing');
    await page.keyboard.press('Control+Shift+z'); await images(1);
    console.log('PASS image insertion has its own undo/redo step');

    await view('对照');
    const draftContent = await source().inputValue();
    assert.match(draftContent, /md-draft-image:/);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    await page.locator('#save').click(); await idle(); await images(1);
    assert.equal(await source().inputValue(), draftContent, 'Canceling Save keeps the draft and its image');
    const savedSession = await waitRecovery(value => value.documents.some(document => !document.path && document.draft?.includes('md-draft-image:') && document.viewState?.view === 'compare'));
    const draftId = savedSession.activeId;
    await restoreClipboard();
    await app.evaluate(({ app }) => app.exit(0));
    await launch(); await images(1);
    assert.equal(await source().isVisible(), true, 'The recovered comparison view must be visible before testing its source editor');
    assert.match(await source().inputValue(), /md-draft-image:/, 'The unsaved image survives process restart');
    assert.equal((await waitRecovery(value => value.activeId === draftId)).activeId, draftId);
    console.log('PASS draft image checkpoint and restart recovery');

    const savedPath = path.join(directory, '含 截图的文档.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, savedPath);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '含 截图的文档.md');
    await idle(); await images(1);
    assert.equal(await source().isVisible(), true, 'First save must preserve the comparison view');
    const savedText = await readFile(savedPath, 'utf8');
    assert.doesNotMatch(savedText, /md-draft-image:|moye-image:|data:image/);
    assert.match(savedText, /\.assets\//);
    assert.equal(await source().inputValue(), savedText.replace(/\r\n/g, '\n'));
    const assetFiles = await readdir(path.join(directory, '含 截图的文档.assets'));
    assert.equal(assetFiles.length, 1);
    assert.ok((await readFile(path.join(directory, '含 截图的文档.assets', assetFiles[0]))).length > 0);
    console.log('PASS first save materializes draft image into portable relative assets');

    await source().focus(); await page.keyboard.press('Control+End');
    await pasteScreenshot(); await images(2);
    const withSecond = await source().inputValue();
    assert.doesNotMatch(withSecond, /md-draft-image:/, 'Saved documents import directly into assets');
    await page.keyboard.press('Control+z'); await images(1);
    assert.equal(await source().inputValue(), savedText.replace(/\r\n/g, '\n'));
    await page.keyboard.press('Control+Shift+z'); await images(2);
    assert.equal(await source().inputValue(), withSecond);
    console.log('PASS source/compare clipboard insertion and undo/redo');

    await page.locator('#save').click(); await idle();
    const finalText = await readFile(savedPath, 'utf8');
    await page.screenshot({ path: path.join(directory, 'pasted-images-compare.png') });
    await restoreClipboard();
    await app.evaluate(({ app }) => app.exit(0));
    await launch([savedPath]); await images(2);
    assert.equal(await readFile(savedPath, 'utf8'), finalText);

    await view('正文');
    if (await page.locator('.tiptap').getAttribute('contenteditable') !== 'true') { await view('编辑'); }
    await page.locator('.tiptap').focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
    await dropImages(2); await images(4);
    await page.keyboard.press('Control+z'); await images(2);
    await page.keyboard.press('Control+Shift+z'); await images(4);
    console.log('PASS multiple-file drop event inserts and undoes as one operation');

    await view('对照');
    const beforeInvalid = await source().inputValue();
    await source().evaluate(element => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['not a valid PNG'], '伪装图片.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '请选择有效的 PNG、JPEG、GIF 或 WebP 图片。' && !document.querySelector('#new').disabled);
    assert.equal(await source().inputValue(), beforeInvalid, 'Rejected image does not replace source selection');
    await images(4);
    await app.evaluate(async ({ clipboard }) => clipboard.writeText('普通文字粘贴'));
    await source().focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+v');
    await page.waitForFunction(() => document.querySelector('.source-input').value.includes('普通文字粘贴'));
    assert.match(await source().inputValue(), /普通文字粘贴/);
    await images(4);
    console.log('PASS malformed-image rejection and ordinary text clipboard handling');

    await page.locator('#rename').click();
    const nameBefore = await page.locator('#filename').inputValue();
    await pasteScreenshot(); await page.waitForTimeout(100);
    assert.equal(await page.locator('#filename').inputValue(), nameBefore, 'Image paste does not alter a file-name input');
    await page.keyboard.press('Escape');
    await images(4);
    console.log('PASS image paste is scoped to the document editor');

    const originalTabName = await page.locator('#document-name').textContent();
    const beforeSwitch = await source().inputValue();
    const delayedBytes = await app.evaluate(({ nativeImage }) => [...nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 120), { width: 8, height: 8 }).toPNG()]);
    const newResult = await source().evaluate(async (element, bytes) => {
      const originalRead = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        if (this.name === 'delayed.png') await new Promise(resolve => setTimeout(resolve, 700));
        return originalRead.call(this);
      };
      try {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], 'delayed.png', { type: 'image/png' }));
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
        const result = await window.moye.newDocument();
        await new Promise(resolve => setTimeout(resolve, 850));
        return result;
      } finally { File.prototype.arrayBuffer = originalRead; }
    }, delayedBytes);
    assert.ok(!newResult?.error, 'The external document switch must actually happen');
    await idle();
    assert.notEqual(await page.locator('#document-name').textContent(), originalTabName);
    assert.equal(await page.locator('.tiptap img').count(), 0, 'Pending image must never appear in a different tab');
    await page.getByRole('tab', { name: originalTabName, exact: true }).click(); await idle(); await images(4);
    assert.equal(await source().inputValue(), beforeSwitch);
    console.log('PASS asynchronous image import cancels safely after document switching');

    await page.locator('#new').click(); await idle(); await view('源码');
    const emptyPath = path.join(directory, '空白保存.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, emptyPath);
    await page.locator('#save').click(); await idle();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '空白保存.md');
    assert.equal(await source().isVisible(), true, 'First save must preserve the source view');
    await source().focus(); await pasteScreenshot();
    await page.waitForFunction(() => document.querySelector('.source-input').value.includes('.assets/'));
    await idle(); await view('对照'); await images(1);
    console.log('PASS source image import still works after first saving an empty draft');

    const pickedPath = path.join(directory, '按钮插入.png');
    const pickedBytes = await app.evaluate(({ nativeImage }) => [...nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 100), { width: 8, height: 8 }).toPNG()]);
    await writeFile(pickedPath, Buffer.from(pickedBytes));
    await page.locator('#new').click(); await idle();
    await app.evaluate(({ dialog }, imagePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] }); }, pickedPath);
    await page.getByRole('toolbar', { name: '常用格式', exact: true }).getByRole('button', { name: '图片', exact: true }).click();
    await images(1);
    assert.ok(!await page.locator('#document-name').textContent().then(name => name.endsWith('.md')), 'The image picker must not force a new document to save first');
    console.log('PASS the existing Image button also supports unsaved drafts');
    assert.deepEqual(errors, []);
    console.log('PASS saved images reopen correctly; renderer errors: 0');
    console.log('Evidence: ' + directory);
  } finally {
    if (app) {
      await restoreClipboard().catch(() => { console.error('Clipboard restoration failed; check the system clipboard.'); process.exitCode = 1; });
      if (page && !page.isClosed()) await page.screenshot({ path: path.join(directory, 'final-state.png') }).catch(() => {});
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
