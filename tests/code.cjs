const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/code');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '代码测试.md');
  const original = '# 代码语法高亮\n\n```javascript\nconst answer = 42;\n```\n\n```python\ndef greet(name):\n    return "Hello " + name\n```\n\n```\nfunction hello() { return true; }\n```\n\n```plaintext\nconst plain = "保持纯文本";\n```\n';
  await writeFile(fixture, original);
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('pre code.language-javascript .hljs-keyword');
    if (await page.locator('body').evaluate(body => body.classList.contains('dark'))) {
      await page.locator('#more-toggle').click(); await page.locator('#theme').click();
    }
    assert.equal(await page.locator('code.language-python .hljs-keyword').first().textContent(), 'def');
    assert.equal(await page.locator('code.language-plaintext .hljs-keyword').count(), 0);
    const colors = await page.locator('code.language-javascript').evaluate(code => ({ keyword: getComputedStyle(code.querySelector('.hljs-keyword')).color, number: getComputedStyle(code.querySelector('.hljs-number')).color }));
    assert.notEqual(colors.keyword, colors.number, '语法类型必须显示不同颜色');
    assert.equal(await page.locator('#dirty-dot').isVisible(), false, '阅读高亮不应修改文档');
    assert.equal(await page.locator('#code-language-picker').isVisible(), false);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.equal(await readFile(fixture, 'utf8'), original, '高亮不应重写原文');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    await page.locator('code.language-javascript').click();
    await page.getByRole('combobox', { name: '代码语言', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('combobox', { name: '代码语言', exact: true }).isVisible(), true);
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.keyboard.insertText('const answer = "changed";');
    await page.waitForFunction(() => document.querySelector('code.language-javascript .hljs-string')?.textContent === '"changed"');
    const picker = page.getByRole('combobox', { name: '代码语言', exact: true });
    await picker.selectOption('plaintext');
    assert.equal(await page.locator('code.language-plaintext').first().locator('.hljs-keyword').count(), 0);
    await picker.selectOption('javascript');
    await page.waitForSelector('code.language-javascript .hljs-keyword');
    await picker.selectOption('');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    const saved = await readFile(fixture, 'utf8');
    assert.match(saved, /```\nconst answer = "changed";/);
    assert.match(saved, /```python\ndef greet/);
    assert.doesNotMatch(saved, /hljs-|<span/);
    await picker.selectOption('javascript');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    // Close the saved tab so Open exercises a fresh read, rather than cached activation.
    await page.keyboard.press('Control+w');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '未命名');
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, fixture);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'false');
    await page.waitForSelector('code.language-javascript .hljs-string');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    await page.locator('code.language-javascript').click();
    for (const width of [1180, 800]) {
      await page.setViewportSize({ width, height: 820 });
      const bar = await page.locator('.page-bar').boundingBox();
      const body = await page.locator('.canvas').boundingBox();
      const language = await picker.boundingBox();
      assert.ok(bar.y + bar.height <= body.y + 0.5 && language.y + language.height <= bar.y + bar.height, '语言选择不能侵入正文滚动区域');
    }
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.screenshot({ path: path.join(testDir, 'highlight-light.png'), scale: 'css' });
    await page.locator('#more-toggle').click(); await page.locator('#theme').click();
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dark')), true);
    await page.screenshot({ path: path.join(testDir, 'highlight-dark.png'), scale: 'css' });
    assert.deepEqual(errors, []);
    console.log('CODE PASS: colored reading, live editing, auto/manual/plaintext languages, Markdown preservation, save/reopen, contextual language picker, wide/narrow layout, and light/dark themes');
  } catch (error) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      console.error('CODE FAILURE STATE:', await page.evaluate(() => ({ pickerHidden: document.querySelector('#code-language-picker')?.hidden, editable: document.querySelector('.tiptap')?.getAttribute('contenteditable'), selection: window.getSelection()?.anchorNode?.parentElement?.outerHTML.slice(0, 350), toast: document.querySelector('#toast')?.textContent })).catch(() => null));
      await page.screenshot({ path: path.join(testDir, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
