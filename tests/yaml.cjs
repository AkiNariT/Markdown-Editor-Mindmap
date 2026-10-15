const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { parse } = require('yaml');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/yaml');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, 'SKILL.md');
  const prefix = '\ufeff---\r\n# keep header\r\nname: my-skill # keep name\r\ndescription: >- # keep description\r\n  完成一个任务。\r\n  当用户提出请求时使用。\r\nmetadata:\r\n  category: "sample"\r\n  items: [one, two]\r\n---\r\n\r\n';
  await writeFile(fixture, prefix + '# 技能正文\r\n\r\n这里是正文。\r\n');
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap h1');
    assert.equal(await page.locator('#protection').isVisible(), false, '合法 YAML 不应显示不能编辑的警告');
    const name = page.getByRole('textbox', { name: '技能名称', exact: true });
    const description = page.getByRole('textbox', { name: '用途与触发条件', exact: true });
    assert.equal(await name.inputValue(), 'my-skill');
    assert.equal(await name.evaluate(input => input.readOnly), true);
    assert.equal(await description.inputValue(), '完成一个任务。 当用户提出请求时使用。');
    assert.ok(!(await page.locator('.tiptap').textContent()).includes('name:'));
    await app.evaluate(({ dialog }) => { globalThis.yamlWarningCount = 0; globalThis.yamlSaveDialogCount = 0; dialog.showMessageBox = async () => { globalThis.yamlWarningCount++; return { response: 0 }; }; dialog.showSaveDialog = async () => { globalThis.yamlSaveDialogCount++; return { canceled: true }; }; });
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    assert.equal(await app.evaluate(() => globalThis.yamlWarningCount), 0);
    await page.locator('.tiptap > p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText('新增正文');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    let saved = await readFile(fixture, 'utf8');
    assert.ok(saved.startsWith(prefix), '只改正文时文件头每个字节均保留');
    assert.match(saved, /新增正文/);
    assert.equal(await app.evaluate(() => globalThis.yamlSaveDialogCount), 0, '已有合法 YAML 文件可直接保存');

    await name.fill('test-skill'); await description.fill('处理 "引用" 与 : 冒号\n当用户请求时使用。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    saved = await readFile(fixture, 'utf8');
    const yaml = saved.replace(/^\ufeff/, '').split(/\r?\n---\r?\n/)[0].replace(/^---\r?\n/, '');
    const metadata = parse(yaml);
    assert.equal(metadata.name, 'test-skill');
    assert.equal(metadata.description, '处理 "引用" 与 : 冒号\n当用户请求时使用。');
    assert.deepEqual(metadata.metadata, { category: 'sample', items: ['one', 'two'] });
    assert.ok(saved.includes('# keep name\r\n') && saved.includes('# keep description\r\n'));
    assert.equal(/(?<!\r)\n/.test(saved), false);

    await name.fill('Invalid Name');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('技能名称'));
    assert.equal(await readFile(fixture, 'utf8'), saved, '名称错误不写入文件');
    await page.getByRole('button', { name: '关闭 SKILL.md', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('技能名称') && document.querySelector('#skill-name').readOnly === false);
    assert.equal(await name.inputValue(), 'Invalid Name', '提示保存但字段无效时保持当前编辑内容');
    assert.match(await page.locator('.tiptap').textContent(), /新增正文/);
    await name.fill('test-skill');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, fixture);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#skill-name').readOnly === true);
    assert.equal(await name.inputValue(), 'test-skill');
    assert.equal(await description.inputValue(), metadata.description);
    assert.equal(await page.locator('#protection').isVisible(), false);

    const generic = path.join(testDir, '普通YAML.md');
    const genericPrefix = '---\nname: My Page\ndescription: "普通页面 <metadata>"\ntitle: 我的笔记\nimageExample: "![alt](somewhere.png)"\ncustom: {count: 3, tags: [a, b]}\n---\n\n';
    await writeFile(generic, genericPrefix + '# 普通正文\n\n可以编辑。\n');
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, generic);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '普通YAML.md');
    assert.equal(await page.locator('#protection').isVisible(), false);
    assert.equal(await page.locator('#skill-fields').isVisible(), false);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('.tiptap > p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText('新内容');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存');
    assert.ok((await readFile(generic, 'utf8')).startsWith(genericPrefix));
    const moved = path.join(testDir, 'subdir', '另存.md'); await mkdir(path.dirname(moved), { recursive: true });
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, moved);
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === '另存.md');
    assert.ok((await readFile(moved, 'utf8')).startsWith(genericPrefix), '另存不得改写文件头中的图片示例');

    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.getByRole('button', { name: 'SKILL 模板', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'SKILL.md');
    assert.equal(await page.locator('#protection').isVisible(), false);
    assert.equal(await name.inputValue(), 'my-skill');
    assert.equal(await name.evaluate(input => input.readOnly), false);
    for (const width of [1180, 800]) {
      await page.setViewportSize({ width, height: 720 });
      const fits = await page.locator('#frontmatter-info').evaluate(card => [...card.querySelectorAll('input,textarea')].every(item => { const rect = item.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
      assert.ok(fits);
    }
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.screenshot({ path: process.env.MOYE_SKILL_PREVIEW || path.join(testDir, 'skill.png'), scale: 'css' });
    assert.deepEqual(errors, []);
    console.log('YAML PASS: no blanket warning; editable skill fields; exact opaque header retention; direct save; comments/unknown fields/BOM/CRLF; invalid-field save/guard rejection; reopen; generic YAML and Save As; reusable draft and responsive card');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
