const { _electron: electron } = require('playwright');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/position');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '阅读位置.md');
  const original = '# 阅读位置测试\n\n' + Array.from({ length: 100 }, (_, index) => `## 第 ${index + 1} 段\n\n位置标记 ${index + 1}：阅读到这里时，点击编辑应留在这里。\n\n` + (index === 39 ? '```js\nconst position = 40;\n```\n\n' : '')).join('');
  await writeFile(fixture, original);
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.tiptap h1');
    for (const scenario of [
      { width: 1180, height: 820, outline: false },
      { width: 800, height: 640, outline: true },
      { width: 720, height: 540, outline: false },
    ]) {
      await app.evaluate(({ BrowserWindow }, scenario) => BrowserWindow.getAllWindows()[0].setContentSize(scenario.width, scenario.height), scenario);
      await page.waitForFunction(width => innerWidth === width, scenario.width);
      if ((await page.locator('#outline').isVisible()) !== scenario.outline) await page.locator('#outline-toggle').click();
      for (const place of ['middle', 'end']) {
        await page.locator('.canvas').evaluate((canvas, place) => {
          canvas.scrollTo({ top: place === 'end' ? canvas.scrollHeight : 1500, behavior: 'instant' });
        }, place);
        const before = await page.evaluate(() => {
          const canvas = document.querySelector('.canvas').getBoundingClientRect();
          const paragraphs = [...document.querySelectorAll('.tiptap > p')];
          const index = paragraphs.findIndex(p => p.getBoundingClientRect().top > canvas.top + 80 && p.getBoundingClientRect().bottom < canvas.bottom);
          return { index, y: paragraphs[index].getBoundingClientRect().top, scroll: document.querySelector('.canvas').scrollTop };
        });
        assert.ok(before.index >= 0 && before.scroll > 1000, '测试必须从正文中部或末尾开始');
        for (const mode of ['编辑', '阅读']) {
          await page.getByRole('button', { name: mode, exact: true }).click();
          await page.waitForFunction(editable => document.querySelector('.tiptap').getAttribute('contenteditable') === String(editable), mode === '编辑');
          const positions = await page.evaluate(index => new Promise(resolve => {
            const positions = [];
            const observe = () => {
              positions.push(document.querySelectorAll('.tiptap > p')[index].getBoundingClientRect().top);
              if (positions.length === 20) resolve(positions); else requestAnimationFrame(observe);
            };
            requestAnimationFrame(observe);
          }), before.index);
          assert.ok(positions.every(y => Math.abs(y - before.y) < 1.5), `${mode}后正文位置移动：${JSON.stringify({ scenario, place, before, positions })}`);
          assert.equal(await page.locator('#dirty-dot').isVisible(), false, '切换模式不应修改文档');
        }
        for (let repeat = 0; repeat < 5; repeat++) {
          await page.keyboard.press('Control+Shift+E');
          await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
          await page.keyboard.press('Control+Shift+E');
          await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'false');
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const afterShortcut = await page.evaluate(index => ({ y: document.querySelectorAll('.tiptap > p')[index].getBoundingClientRect().top, scroll: document.querySelector('.canvas').scrollTop, editing: document.body.classList.contains('editing'), mode: document.querySelector('#mode').textContent }), before.index);
        assert.ok(Math.abs(afterShortcut.y - before.y) < 1.5, '快捷键切换也应保持正文位置：' + JSON.stringify({ scenario, place, before, afterShortcut }));
      }
    }
    // A retained caret in an offscreen code block must not pull the viewport back.
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('.tiptap pre').click();
    await page.waitForSelector('#code-language-picker:visible');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await page.locator('.canvas').evaluate(canvas => canvas.scrollTo({ top: 1500, behavior: 'instant' }));
    const codeAnchor = page.locator('.tiptap > p').nth(14);
    const beforeCode = await codeAnchor.evaluate(p => p.getBoundingClientRect().top);
    for (const mode of ['编辑', '阅读']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForFunction(editable => document.querySelector('.tiptap').getAttribute('contenteditable') === String(editable), mode === '编辑');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(Math.abs(await codeAnchor.evaluate(p => p.getBoundingClientRect().top) - beforeCode) < 1.5, '光标在屏幕外代码块时仍应保持当前位置');
    }
    const skillFixture = path.join(testDir, 'SKILL.md');
    const skillOriginal = '---\nname: position-test\ndescription: 测试 SKILL 文件切换模式时保持当前阅读位置。\n---\n\n' + original;
    await writeFile(skillFixture, skillOriginal);
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, skillFixture);
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#document-name').textContent === 'SKILL.md');
    await page.locator('.canvas').evaluate(canvas => canvas.scrollTo({ top: 1500, behavior: 'instant' }));
    const skillAnchor = page.locator('.tiptap > p').nth(12);
    const beforeSkill = await skillAnchor.evaluate(p => p.getBoundingClientRect().top);
    for (const mode of ['编辑', '阅读']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForFunction(editable => document.querySelector('.tiptap').getAttribute('contenteditable') === String(editable), mode === '编辑');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(Math.abs(await skillAnchor.evaluate(p => p.getBoundingClientRect().top) - beforeSkill) < 1.5, 'SKILL 信息栏切换读写也应保持正文位置');
    }
    await page.locator('.canvas').evaluate(canvas => canvas.scrollTo({ top: 0, behavior: 'instant' }));
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.locator('#skill-name').isVisible(), true, '在顶部切换时信息栏应仍可见');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    assert.equal(await page.locator('#skill-name').isVisible(), true);
    assert.equal(await readFile(fixture, 'utf8'), original, '切换模式不应写入文件');
    assert.equal(await readFile(skillFixture, 'utf8'), skillOriginal);
    assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('POSITION PASS: visible text stays in place at middle/end, wide/narrow/outline layouts and repeated shortcuts; offscreen code caret, SKILL metadata and document top; no file changes');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
