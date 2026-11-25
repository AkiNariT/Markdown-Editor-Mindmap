const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const parent = path.join(root, '.desktop-test');
  await fs.mkdir(parent, { recursive: true });
  const dir = await fs.mkdtemp(path.join(parent, 'typing-'));
  const file = path.join(dir, '长文.md');
  const body = Array.from({ length: 200 }, (_, i) => '## 标题' + i + '\n\n' + '长文正文'.repeat(28)).join('\n\n');
  await fs.writeFile(file, body);
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'),
    args: [...(process.env.MOYE_EXE ? [] : [root]), file, '--user-data-dir=' + path.join(dir, 'profile')] });
  try {
    const page = await app.firstWindow();
    await page.locator('.tiptap h2').first().waitFor();
    await page.click('#mode'); await page.click('[data-view="compare"]');
    const input = page.locator('.source-input');
    await input.evaluate(node => { node.focus(); node.setSelectionRange(node.value.length, node.value.length); });
    await page.evaluate(() => {
      window.replacements = 0; window.outlineChanges = 0;
      document.querySelector('.tiptap').editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) window.replacements++; });
      new MutationObserver(() => window.outlineChanges++).observe(document.querySelector('#outline-items'), { childList: true });
    });
    const cdp = await page.context().newCDPSession(page);
    for (const text of ['n', 'ni', '你']) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    assert.equal(await input.inputValue(), body + '你');
    assert.equal(await page.evaluate(() => window.replacements), 0, '候选词期间不重建预览');
    await cdp.send('Input.insertText', { text: '你' });
    await page.waitForFunction(() => document.querySelector('.tiptap').lastElementChild.textContent.endsWith('你'));
    assert.equal(await page.evaluate(() => window.replacements), 1, '提交中文后仅更新一次');
    assert.equal(await page.evaluate(() => window.outlineChanges), 0, '隐藏的目录不重建');
    await page.keyboard.press('Control+z'); assert.equal(await input.inputValue(), body);
    const counts = await input.evaluate(node => {
      window.replacements = 0;
      for (const ch of 'abcd') document.execCommand('insertText', false, ch);
      return { updates: window.replacements, dirty: !document.querySelector('#dirty-dot').hidden };
    });
    assert.deepEqual(counts, { updates: 0, dirty: true }, '连续输入立刻更新脏标记，合并后台预览');
    await page.waitForFunction(() => document.querySelector('.tiptap').lastElementChild.textContent.endsWith('abcd'));
    assert.equal(await page.evaluate(() => window.replacements), 1);
    await page.click('#outline-toggle');
    assert.equal(await page.locator('#outline-items button').count(), 200);
    await input.fill((await input.inputValue()).replace('## 标题0', '## 刚改的标题'));
    await page.locator('#outline-items button').filter({ hasText: '刚改的标题' }).waitFor();
    await input.evaluate(node => {
      node.focus(); node.setSelectionRange(node.value.length, node.value.length);
      document.execCommand('insertText', false, '左');
      const visual = document.querySelector('.tiptap');
      visual.focus(); visual.editor.commands.focus('end'); visual.editor.commands.insertContent('右');
    });
    assert.match((await input.inputValue()).slice(-30), /abcd左右\s*$/, '预览排队时切换到右栏续写保留两侧输入');
    await input.evaluate(node => {
      node.focus(); node.setSelectionRange(node.value.length, node.value.length); document.execCommand('insertText', false, '存');
    });
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden);
    assert.equal(await fs.readFile(file, 'utf8'), await input.inputValue());
    console.log('Long document input, IME, outline, cross-pane editing and immediate save passed.');
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
