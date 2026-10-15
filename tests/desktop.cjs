const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const testDir = path.join(__dirname, '../.desktop-test'); await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '测试.md');
  await writeFile(fixture, '# 测试文档\n\n可视化编辑测试。\n\n## 第二章\n\n- [ ] 待办事项\n\n| 名称 | 数量 |\n| --- | --- |\n| 中文 | 2 |\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    app.process().stderr.on('data', bytes => process.stderr.write(bytes));
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('RENDERER ERROR:', e.message); });
    page.on('console', message => { if (message.type() === 'error') console.error('CONSOLE ERROR:', message.text()); });
    await page.waitForSelector('.tiptap h1', { timeout: 15000 });
    assert.equal(await page.locator('#toast').isVisible(), false, 'startup should not display an error');
    assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'), 'false');
    assert.equal(await page.locator('.tiptap h1').textContent(), '测试文档');
    await page.screenshot({ path: path.join(testDir, 'reading.png') });
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'), 'true');
    const controls = page.getByRole('toolbar', { name: '常用格式', exact: true });
    for (const name of ['引用', '表格', '图片', '代码块', '分隔线']) {
      assert.equal(await controls.getByRole('button', { name, exact: true }).isVisible(), true, `${name} 必须直接显示在编辑栏`);
    }
    // Block formatting must be discoverable and usable with only a caret, without selected text.
    const paragraph = page.locator('.tiptap > p').first();
    await paragraph.click();
    await controls.getByRole('button', { name: '引用', exact: true }).click();
    assert.match(await page.locator('.tiptap blockquote').first().textContent(), /可视化编辑测试/);
    await controls.getByRole('button', { name: '引用', exact: true }).click();
    await controls.getByRole('button', { name: '代码块', exact: true }).click();
    assert.match(await page.locator('.tiptap pre').first().textContent(), /可视化编辑测试/);
    await controls.getByRole('button', { name: '代码块', exact: true }).click();
    await page.getByRole('combobox', { name: '段落格式', exact: true }).selectOption('3');
    assert.equal(await page.locator('.tiptap h3').first().textContent(), '可视化编辑测试。');
    await page.getByRole('combobox', { name: '段落格式', exact: true }).selectOption('paragraph');
    await page.getByRole('button', { name: '无序列表', exact: true }).click();
    assert.match(await page.locator('.tiptap ul:not([data-type="taskList"])').first().textContent(), /可视化编辑测试/);
    await page.getByRole('button', { name: '有序列表', exact: true }).click();
    assert.match(await page.locator('.tiptap ol').first().textContent(), /可视化编辑测试/);
    await page.getByRole('button', { name: '有序列表', exact: true }).click();
    await page.getByRole('button', { name: '待办清单', exact: true }).click();
    assert.match(await page.locator('.tiptap ul[data-type="taskList"]').first().textContent(), /可视化编辑测试/);
    await page.getByRole('button', { name: '待办清单', exact: true }).click();
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'false');
    assert.equal(await page.getByRole('combobox', { name: '段落格式', exact: true }).isVisible(), false);
    assert.equal(await controls.isVisible(), false, '阅读模式收起整组格式按钮');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    const originalBytes = await readFile(fixture, 'utf8');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.equal(await readFile(fixture, 'utf8'), originalBytes, 'entering edit mode must not rewrite original');
    const body = page.locator('.tiptap'); await body.click(); await body.press('Control+Home'); await body.press('End'); await body.press('Enter');
    await body.pressSequentially('直观编辑内容'); await body.press('Shift+Home');
    await page.getByRole('button', { name: '粗体', exact: true }).click();
    assert.match(await body.innerHTML(), /<strong>直观编辑内容<\/strong>/);
    await page.screenshot({ path: path.join(testDir, 'editing.png') });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.match(await readFile(fixture, 'utf8'), /\*\*直观编辑内容\*\*/);
    await body.press('Control+End'); await body.press('Enter'); await body.pressSequentially('尚未保存');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForTimeout(250);
    assert.equal(page.isClosed(), false);
    assert.match(await body.textContent(), /尚未保存/);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').textContent.trim() === '');
    await body.click(); await body.pressSequentially('新建的中文文档');
    const savePath = path.join(testDir, '新建 文档.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, savePath);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.equal(await readFile(savePath, 'utf8'), '新建的中文文档\n');

    // Insert and edit a table through the visible button and real dialog.
    await body.press('Control+End'); await body.press('Enter');
    await controls.getByRole('button', { name: '表格', exact: true }).click();
    await page.locator('#table-confirm').click();
    await page.waitForSelector('.tiptap table');
    assert.equal(await page.locator('.tiptap table tr').count(), 3);
    await page.locator('.tiptap table th').first().click(); await page.keyboard.insertText('列一');
    await body.press('Control+End'); await body.press('ArrowDown');
    const pixelPath = path.join(testDir, '图片.png');
    await writeFile(pixelPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X0AAAAASUVORK5CYII=', 'base64'));
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, pixelPath);
    await controls.getByRole('button', { name: '图片', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap figure img')?.naturalWidth > 0);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.match(await readFile(savePath, 'utf8'), /%20/);
    assert.match(await readFile(savePath, 'utf8'), /列一/);
    await body.press('Control+End');
    await controls.getByRole('button', { name: '分隔线', exact: true }).click();
    assert.equal(await page.locator('.tiptap hr').count(), 1);

    const otherDir = path.join(testDir, '另一个目录'); await mkdir(otherDir, { recursive: true });
    const movedPath = path.join(otherDir, '另存.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, movedPath);
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '另存.md');
    await page.waitForFunction(() => document.querySelector('.tiptap figure img')?.naturalWidth > 0);
    assert.match(await readFile(movedPath, 'utf8'), /\.\.\//);

    // A native save conflict must retain both the external file and our editor buffer.
    await writeFile(movedPath, '# 外部版本\n');
    await page.locator('.tiptap > p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('未丢失的内容');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('外部'));
    assert.equal(await readFile(movedPath, 'utf8'), '# 外部版本\n');
    assert.match(await body.textContent(), /未丢失的内容/);
    const recovered = path.join(otherDir, '恢复.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, recovered);
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '恢复.md');
    assert.equal(await page.locator('#protection').isVisible(), false, '保存提示测试应使用普通 Markdown 段落');

    // Canceling Open keeps the active buffer without saving or replacing its tab.
    await page.locator('.tiptap > p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('保存后取消打开');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.getByRole('button', { name: '打开', exact: true }).click();
    assert.equal(await page.locator('#save-state').textContent(), '尚未保存');
    assert.ok(!(await readFile(recovered, 'utf8')).includes('保存后取消打开'));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.match(await readFile(recovered, 'utf8'), /保存后取消打开/);

    const protectedPath = path.join(testDir, '保护.md');
    const protectedOriginal = '---\ntitle: 元数据\n---\n\n# 保护文档\n\n<!-- 保留注释 -->\n正文。\n'; await writeFile(protectedPath, protectedOriginal);
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, protectedPath);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '保护.md');
    assert.equal(await page.locator('#protection').isVisible(), true);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    await body.click(); await body.press('Control+End'); await body.press('Enter'); await page.keyboard.insertText('编辑的副本');
    const protectedCopy = path.join(testDir, '保护副本.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, protectedCopy);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '保护副本.md');
    assert.equal(await readFile(protectedPath, 'utf8'), protectedOriginal);
    assert.match(await readFile(protectedCopy, 'utf8'), /编辑的副本/);

    await page.setViewportSize({ width: 800, height: 640 });
    await page.screenshot({ path: path.join(testDir, 'compact.png') });
    assert.deepEqual(errors, []);
    console.log('DESKTOP PASS: reading, direct editing, formatting, original preservation, save, cancel-close, new tab, table, local image, Save As image rebasing, external conflict, canceled-open buffer, protected copy, compact layout');
  } catch (error) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      console.error('TEST FAILURE STATE:', await page.evaluate(() => ({ name: document.querySelector('#document-name')?.textContent, save: document.querySelector('#save-state')?.textContent, toast: document.querySelector('#toast')?.textContent, editable: document.querySelector('.tiptap')?.getAttribute('contenteditable'), dirty: !document.querySelector('#dirty-dot')?.hidden })).catch(() => null));
      await page.screenshot({ path: path.join(testDir, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
