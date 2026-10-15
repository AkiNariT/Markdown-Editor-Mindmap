const { _electron: electron } = require('playwright');
const path = require('node:path');
(async () => {
  const executablePath = process.env.MOYE_EXE || require('electron');
  const sample = process.env.MOYE_SAMPLE || (process.env.MOYE_EXE ? path.resolve(path.dirname(executablePath), '../示例.md') : path.resolve(__dirname, '../示例.md'));
  const args = process.env.MOYE_EXE ? [sample] : [path.resolve(__dirname, '..'), sample];
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + path.resolve(__dirname, '../.desktop-test/profile')], timeout: 30000 });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.tiptap h1');
    await page.setViewportSize({ width: 1180, height: 820 });
    const dark = process.env.MOYE_PREVIEW_DARK === 'true';
    if (await page.locator('body').evaluate(body => body.classList.contains('dark')) !== dark) {
      await page.locator('#more-toggle').click(); await page.locator('#theme').click();
    }
    if (process.env.MOYE_PREVIEW_EDIT === 'true') {
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.tiptap').getAttribute('contenteditable') === 'true');
      await page.locator('.tiptap p').first().click();
      await page.waitForFunction(() => document.querySelector('#block-style').value === 'paragraph');
    }
    await page.screenshot({ path: process.env.MOYE_PREVIEW || path.resolve(__dirname, '../.desktop-test/preview.png'), scale: 'css' });
    if (process.env.MOYE_PREVIEW_EDIT === 'true') {
      await page.locator('.canvas').evaluate(element => { element.scrollTop = 400; });
      const box = await page.locator('.page-bar').boundingBox();
      const body = await page.locator('.canvas').boundingBox();
      if (!box || !body || box.y + box.height > body.y + 0.5) throw new Error('常用格式栏遮挡了正文滚动区域');
      await page.locator('.canvas').evaluate(element => { element.scrollTop = 0; });
    }
    console.log('Captured actual packaged application preview');
  } finally { await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
