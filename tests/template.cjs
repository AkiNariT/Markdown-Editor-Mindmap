const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/template');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '按钮测试.md');
  await writeFile(fixture, '# 当前文档\n\n需要保留的正文。\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const templatePath = process.env.MOYE_EXE
    ? path.join(path.dirname(executablePath), 'resources/app/assets/templates/SKILL.md')
    : path.resolve(__dirname, '../assets/templates/SKILL.md');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap h1');
    const button = page.getByRole('button', { name: 'SKILL 模板', exact: true });
    assert.equal(await button.count(), 1, '顶部应直接显示 SKILL 模板按钮');
    assert.equal(await button.isVisible(), true);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('.tiptap > p').first().click();
    await page.keyboard.press('End'); await page.keyboard.insertText('未保存的文字');
    await page.waitForFunction(() => !document.querySelector('#dirty-dot').hidden);
    await app.evaluate(({ dialog }) => { globalThis.templatePromptCount = 0; dialog.showMessageBox = async () => { globalThis.templatePromptCount++; return { response: 2 }; }; });
    await button.click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'SKILL.md');
    assert.equal(await page.getByRole('tab').count(), 2);
    assert.equal(await app.evaluate(() => globalThis.templatePromptCount), 0, '新标签模板不应要求保存旧文档');
    await page.getByRole('tab', { name: '按钮测试.md', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '按钮测试.md');
    assert.match(await page.locator('.tiptap').textContent(), /未保存的文字/);
    assert.equal(await page.locator('#document-name').textContent(), '按钮测试.md');
    assert.equal(await app.evaluate(() => globalThis.templatePromptCount), 0);

    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    await page.getByRole('button', { name: '关闭 按钮测试.md', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'SKILL.md');
    assert.match(await readFile(fixture, 'utf8'), /未保存的文字/, '关闭旧标签时保存，模板保持打开');
    const originalTemplate = await readFile(templatePath, 'utf8');
    assert.ok(originalTemplate.startsWith('---\nname:'), '程序应包含完整的正式 SKILL 文件模板');
    assert.match(await page.locator('.tiptap').textContent(), /执行步骤/);
    assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'), 'true');
    assert.equal(await page.locator('#protection').isVisible(), false, '支持的 YAML 不应继续警告');
    const savedDraft = path.join(testDir, 'SKILL.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, savedDraft);
    assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.equal(await readFile(templatePath, 'utf8'), originalTemplate);
    assert.equal(await readFile(savedDraft, 'utf8'), originalTemplate, '新建模板首次保存应保留完整原文');

    const clonedTemplate = path.join(testDir, '我的SKILL.md');
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, clonedTemplate);
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '我的SKILL.md');
    assert.equal(await readFile(clonedTemplate, 'utf8'), originalTemplate, '未修改时另存模板应完整保留文件头与正文');

    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').textContent.trim() === '');
    await page.locator('.tiptap').click(); await page.keyboard.insertText('新文档未保存');
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    await page.getByRole('button', { name: '关闭 未命名', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    assert.match(await page.locator('.tiptap').textContent(), /新文档未保存/, '取消保存应中止关闭标签');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.getByRole('button', { name: '关闭 未命名', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '我的SKILL.md');
    await button.click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'SKILL.md');
    assert.equal(await readFile(templatePath, 'utf8'), originalTemplate);

    for (const width of [1180, 800, 680]) {
      await page.setViewportSize({ width, height: 640 });
      const fits = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('.topbar button')].map(item => item.getBoundingClientRect());
        return rects.every((rect, index) => rect.left >= 0 && rect.right <= innerWidth && (!index || rect.left >= rects[index - 1].right));
      });
      assert.ok(fits, '模板按钮与其他顶部操作应完整显示、不重叠：' + width);
    }
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.screenshot({ path: process.env.MOYE_TEMPLATE_PREVIEW || path.join(testDir, 'template.png'), scale: 'css' });
    assert.deepEqual(errors, []);
    console.log('TEMPLATE PASS: visible one-click button adds a tab; original dirty buffer retained; save/discard/canceled-save close guards; bundled template unchanged; YAML bytes and Save As preserved; narrow header fits');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
