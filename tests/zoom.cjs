const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/zoom');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '缩放.md');
  const other = path.join(testDir, '另一份.md');
  const original = '# 缩放测试\n\n' + Array.from({ length: 80 }, (_, i) => `## 第 ${i + 1} 节\n\n缩放位置 ${i + 1}：正文和源码应该一起放大，滚动阅读仍能留在附近。\n\n`).join('') + '长行 ' + 'abcdefghij '.repeat(100) + '\n';
  await writeFile(fixture, original); await writeFile(other, '# 另一份文档\n\n独立缩放。\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap h1');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const wheel = async (selector, delta, ctrl = true) => {
      const bounds = await page.locator(selector).boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      if (ctrl) await page.keyboard.down('Control');
      await page.mouse.wheel(0, delta);
      if (ctrl) await page.keyboard.up('Control');
      await page.waitForTimeout(120); await settle();
    };
    const height = () => page.locator('.tiptap h1').evaluate(node => node.getBoundingClientRect().height);
    const initialHeight = await height();
    const barHeight = await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().height);
    await wheel('.canvas', -120);
    assert.ok(await height() > initialHeight * 1.05, 'Ctrl+滚轮向上应实际放大标题');
    assert.equal(await page.locator('#zoom-reset').textContent(), '110%');
    assert.equal(await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().height), barHeight, '工具栏保持可用尺寸');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1, '不得叠加浏览器整窗缩放');
    await wheel('.canvas', 120); assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
    await wheel('.canvas', 120); assert.equal(await page.locator('#zoom-reset').textContent(), '90%');
    assert.ok(await height() < initialHeight * .95);
    await page.keyboard.press('Control+0'); assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
    await wheel('.canvas', 400, false);
    assert.ok(await page.locator('.canvas').evaluate(node => node.scrollTop) > 0, '普通滚轮仍可阅读滚动');
    assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
    await page.locator('.canvas').evaluate(node => node.scrollTo({ top: 1900, behavior: 'instant' })); await settle();
    const anchor = await page.evaluate(() => {
      const top = document.querySelector('.canvas').getBoundingClientRect().top;
      const nodes = [...document.querySelector('.tiptap').children];
      return nodes.findIndex(node => node.getBoundingClientRect().bottom > top + 5);
    });
    await wheel('.canvas', -120);
    assert.ok(await page.locator('.tiptap').evaluate((node, i) => {
      const a = node.children[i].getBoundingClientRect(), b = document.querySelector('.canvas').getBoundingClientRect();
      return a.bottom >= b.top && a.top < b.bottom;
    }, anchor), '放大后仍可见当前阅读段落');
    assert.equal(await page.locator('#dirty-dot').isVisible(), false, '缩放不能修改文档');
    // Non-default zoom must preserve the existing read/edit position guarantee.
    const textTop = () => page.locator('.tiptap').evaluate((node, i) => node.children[i].getBoundingClientRect().top, anchor);
    const beforeMode = await textTop();
    for (const name of ['编辑', '阅读']) {
      await page.getByRole('button', { name, exact: true }).click(); await settle();
      assert.ok(Math.abs(await textTop() - beforeMode) < 1.5, '非 100% 时阅读/编辑切换也应保持位置');
    }
    await page.getByRole('button', { name: '对照', exact: true }).click();
    const source = page.locator('.source-input');
    const font = () => source.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    assert.ok(Math.abs(await font() - 15.4) < .1, '源码沿用文档缩放');
    await page.locator('#sync-scroll').uncheck();
    await source.evaluate(node => { node.scrollTop = 900; }); await settle();
    const oldLine = await source.evaluate(node => node.scrollTop / parseFloat(getComputedStyle(node).lineHeight));
    await wheel('.source-input', -120);
    assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
    assert.ok(Math.abs(await font() - 16.8) < .1);
    assert.ok(Math.abs(await source.evaluate(node => node.scrollTop / parseFloat(getComputedStyle(node).lineHeight)) - oldLine) < 1, '源码缩放仍保持当前行');
    assert.equal(await source.evaluate(node => getComputedStyle(node).lineHeight), await page.locator('.source-gutter').evaluate(node => getComputedStyle(node).lineHeight), '行号与源码行高一致');
    const geometry = await page.evaluate(() => ({
      header: document.querySelector('.page-bar').getBoundingClientRect().bottom,
      source: document.querySelector('#source-container').getBoundingClientRect().top,
      preview: document.querySelector('.canvas').getBoundingClientRect().top,
      width: document.documentElement.scrollWidth, viewport: innerWidth,
    }));
    assert.ok(geometry.source >= geometry.header && geometry.preview >= geometry.header && geometry.width === geometry.viewport, JSON.stringify(geometry));
    await source.evaluate(node => { node.scrollLeft = 800; }); await settle();
    const sourceLeft = await source.evaluate(node => node.scrollLeft);
    assert.ok(sourceLeft > 700);
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, other);
    await page.locator('#open').click(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '另一份.md');
    assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
    await page.getByRole('tab', { name: '缩放.md', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#zoom-reset').textContent === '120%');
    assert.ok(Math.abs(await source.evaluate(node => node.scrollLeft) - sourceLeft) < 2, '返回标签恢复源码横向阅读位置');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    assert.ok(Math.abs(await font() - 16.8) < .1);
    // Change zoom while the rendered view is hidden, then return to its old block.
    await wheel('.source-input', -120);
    await page.getByRole('button', { name: '正文', exact: true }).click(); await settle();
    assert.ok(await page.locator('.tiptap').evaluate((node, i) => {
      const a = node.children[i].getBoundingClientRect(), b = document.querySelector('.canvas').getBoundingClientRect();
      return a.bottom >= b.top && a.top < b.bottom;
    }, anchor), '隐藏正文期间缩放后，返回仍看得到旧段落');
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await wheel('.source-input', 120);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.source-input').readOnly && !document.querySelector('#save').disabled);
    await source.focus(); await page.keyboard.press('Control+-');
    assert.equal(await page.locator('#zoom-reset').textContent(), '110%');
    assert.equal(await source.inputValue(), original, '快捷缩放不能输入字符');
    await page.keyboard.press('Control+='); assert.equal(await page.locator('#zoom-reset').textContent(), '120%');
    const copy = path.join(testDir, '另存缩放.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, copy);
    await page.keyboard.press('Control+Shift+s');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '另存缩放.md');
    assert.equal(await page.locator('#zoom-reset').textContent(), '120%', '另存为保留当前缩放');
    assert.equal(await readFile(copy, 'utf8'), original);
    await page.locator('#zoom-reset').click(); assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
    await source.focus();
    const undoLine = await source.evaluate(node => {
      const position = node.value.indexOf('缩放位置 35') + 7;
      node.setSelectionRange(position, position);
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
      node.scrollTop = (node.value.slice(0, position).split('\n').length - 3) * lineHeight;
      return node.scrollTop / lineHeight;
    });
    await page.keyboard.insertText('X');
    assert.equal(await page.locator('#dirty-dot').isVisible(), true);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+z'); await settle();
    assert.equal(await source.inputValue(), original);
    assert.ok(Math.abs(await source.evaluate(node => node.scrollTop / parseFloat(getComputedStyle(node).lineHeight)) - undoLine) < 1, '缩放后撤销应恢复相同源码行，而非旧倍率像素位置');
    await page.keyboard.press('Control+0');
    for (let i = 0; i < 30; i++) await page.keyboard.press('Control+-');
    assert.equal(await page.locator('#zoom-reset').textContent(), '50%');
    for (let i = 0; i < 35; i++) await page.keyboard.press('Control+=');
    assert.equal(await page.locator('#zoom-reset').textContent(), '200%');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 620));
    await page.getByRole('button', { name: '对照', exact: true }).click(); await settle();
    assert.ok(await page.locator('#zoom-reset').isVisible());
    assert.ok(await page.evaluate(() => {
      const source = document.querySelector('#source-container').getBoundingClientRect(), preview = document.querySelector('.canvas').getBoundingClientRect();
      return source.bottom <= preview.top + 1 && document.documentElement.scrollWidth === innerWidth;
    }), '窄窗口 200% 对照无重叠和整窗横向溢出');
    await page.keyboard.press('Control+0'); await page.locator('#save').click();
    assert.equal(await readFile(fixture, 'utf8'), original, '缩放不写入文件');
    assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: '对照', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 820));
    await page.keyboard.press('Control+='); await page.keyboard.press('Control+='); await settle();
    await source.evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
    await page.locator('.canvas').evaluate(node => node.scrollTo({ top: 0, behavior: 'instant' })); await settle();
    await page.screenshot({ path: path.resolve(__dirname, '../.desktop-test/MD缩放预览.png') });
    console.log('ZOOM PASS: real Ctrl+wheel, percent, reset, keyboard, bounds, ordinary scrolling, reading anchor, source line/gutter, modes, independent tabs, narrow compare, no file changes');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
