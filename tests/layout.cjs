const { _electron: electron } = require('playwright');
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const testDir = path.resolve(__dirname, '../.desktop-test/layout');
  await mkdir(testDir, { recursive: true });
  const fixture = path.join(testDir, '滚动测试.md');
  await writeFile(fixture, '# 滚动时文字仍然可见\n\n' + Array.from({ length: 60 }, (_, index) => `## 第 ${index + 1} 段\n\n这是正文第 ${index + 1} 段，用来检查编辑栏不会遮挡文字。\n\n- 第一项\n- 第二项\n`).join('\n'));
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = process.env.MOYE_EXE ? [fixture] : [path.resolve(__dirname, '..'), fixture];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.join(testDir, 'profile-' + process.pid + '-' + Date.now())], timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.tiptap h1');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
    for (const scenario of [
      { width: 1180, height: 820, outline: false },
      { width: 800, height: 640, outline: false },
      { width: 800, height: 640, outline: true },
      { width: 680, height: 540, outline: false },
    ]) {
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      if ((await page.locator('#outline').isVisible()) !== scenario.outline) await page.locator('#outline-toggle').click();
      for (const scroll of [0, 430, 1020]) {
        await page.locator('.canvas').evaluate((element, top) => { element.style.scrollBehavior = 'auto'; element.scrollTop = top; }, scroll);
        await page.waitForFunction(top => Math.abs(document.querySelector('.canvas').scrollTop - top) < 1, scroll);
        const geometry = await page.evaluate(() => {
          const bar = document.querySelector('.page-bar').getBoundingClientRect();
          const body = document.querySelector('.canvas').getBoundingClientRect();
          const controls = [...document.querySelectorAll('#edit-controls select, #edit-controls button')].filter(control => control.getClientRects().length > 0);
          return { barBottom: bar.bottom, bodyTop: body.top, controlsFit: controls.every(control => { const rect = control.getBoundingClientRect(); return rect.left >= bar.left && rect.right <= bar.right && rect.bottom <= bar.bottom; }) };
        });
        assert.ok(geometry.barBottom <= geometry.bodyTop + 0.5, `编辑栏侵入正文滚动区域：${JSON.stringify({ scenario, scroll, ...geometry })}`);
        assert.ok(geometry.controlsFit, '窄窗口中格式按钮必须完整显示在编辑栏内');
        const rows = await page.evaluate(() => {
          const items = [...document.querySelectorAll('#edit-controls > button, #edit-controls > label:not(#code-language-picker)')];
          const rows = [];
          for (const item of items) {
            const rect = item.getBoundingClientRect();
            let row = rows.find(row => Math.abs(row.top - rect.top) < 8);
            if (!row) { row = { top: rect.top, widths: [], left: rect.left, right: rect.right }; rows.push(row); }
            row.widths.push(rect.width); row.right = rect.right;
          }
          const toolbar = document.querySelector('#edit-controls').getBoundingClientRect();
          return rows.map(row => ({ ...row, toolbarLeft: toolbar.left, toolbarRight: toolbar.right }));
        });
        for (const row of rows) {
          assert.ok(Math.max(...row.widths) - Math.min(...row.widths) < 1, '每行编辑按钮应等宽：' + JSON.stringify(row));
          assert.ok(Math.abs(row.left - row.toolbarLeft) < 1 && Math.abs(row.right - row.toolbarRight) < 1, '编辑按钮应占满每一行：' + JSON.stringify(row));
        }
      }
      await page.screenshot({ path: path.join(testDir, `editing-${scenario.width}-${scenario.outline ? 'outline' : 'plain'}.png`), scale: 'css' });
    }
    assert.equal(await page.locator('#dirty-dot').isVisible(), false, '滚动和调整窗口不应修改文档');
    await page.evaluate(() => document.body.classList.add('dark'));
    const theme = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor, paper: getComputedStyle(document.querySelector('.topbar')).backgroundColor }));
    assert.deepEqual(theme, { background: 'rgb(0, 0, 0)', paper: 'rgb(10, 10, 10)' });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), '滚动测试.md — MD');
    assert.equal(await page.locator('.brand img').getAttribute('alt'), 'MD');
    console.log('PASS: equal-width controls fill every row without overlapping the document at three scroll positions, wide/narrow sizes and with the outline open; MD branding and black theme verified');
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
