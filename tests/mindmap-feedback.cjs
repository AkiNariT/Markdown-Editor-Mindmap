const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-feedback-')), profile = path.join(dir, 'profile');
  const originalFile = path.join(dir, '课程导图.mdmap'), noteFile = path.join(dir, '课程正文.md');
  const copyDir = path.join(dir, '副本'); await mkdir(copyDir);
  const copyFile = path.join(copyDir, '课程导图副本.mdmap'), svgFile = path.join(dir, '课程导图.svg');
  const longTitle = '基础课程中的观察方法与实例分析需要完整显示，不省略中间的重要信息。'.repeat(5);
  const subtitle = '阅读目标与讨论要点\n记录现象、比较证据、说明结论。'.repeat(2);
  const markdown = '# 基础课程\n\n这段原文必须保留。\n\n## 观察\n\n观察记录。\n\n### 对比\n\n比较资料。\n\n```md\n# 示例中的标题\n```\n\n## 总结\n\n完整结论。\n';
  const item = (id, parent, text, extra = {}) => ({ id, parent, text, file: null, collapsed: false, ...extra });
  await writeFile(noteFile, markdown);
  await writeFile(originalFile, JSON.stringify({ format: 'md-mindmap', version: 2, root: 'root', nodes: [
    item('root', null, '基础课程'), item('a', 'root', '观察与分析', { file: '课程正文.md' }),
    item('b', 'root', '讨论与总结', { offset: { x: 95, y: 40 } }),
  ], connections: [{ id: 'relation', from: 'a', to: 'b' }] }));
  let app, page; const errors = [];
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const card = id => page.locator(`[data-node-card="${id}"]`);
  const theme = () => page.locator('select').filter({ has: page.locator('option[value="crystal"]') });
  const save = async () => { await page.locator('#save').click(); await idle(); await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden); };
  const stored = file => readFile(file, 'utf8').then(JSON.parse);
  const undo = async () => { await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); await settle(); };
  const redo = async () => { await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+y'); await settle(); };
  const selectNode = async id => { await page.locator(`[data-node-id="${id}"]`).click(); await settle(); };
  const geometry = () => page.locator('[data-node-card]').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.nodeCard, { x: parseFloat(card.style.left), y: parseFloat(card.style.top), width: card.offsetWidth, height: card.offsetHeight }])));
  const relativeGeometry = async () => { const all = await geometry(); return Object.fromEntries(Object.entries(all).map(([id, rect]) => [id, { ...rect, x: rect.x - all.root.x, y: rect.y - all.root.y }])); };
  const selectRelation = async () => {
    const hit = page.locator('path[data-connection-id="relation"]'); await hit.scrollIntoViewIfNeeded();
    const point = await hit.evaluate(line => { const p = line.getPointAtLength(line.getTotalLength() / 2), screen = new DOMPoint(p.x, p.y).matrixTransform(line.getScreenCTM()); return { x: screen.x, y: screen.y }; });
    await page.mouse.click(point.x, point.y); await page.locator('.mindmap-connection-editor').waitFor({ state: 'visible' });
  };
  const textFits = async (id, expectedTitle, expectedSubtitle = '') => {
    const result = await card(id).evaluate(node => {
      const card = node.getBoundingClientRect(), buttonElement = node.querySelector('.mindmap-node-button'), button = buttonElement.getBoundingClientRect(), buttonStyle = getComputedStyle(buttonElement), star = node.querySelector('.mindmap-file')?.getBoundingClientRect();
      const problems = [], content = {};
      for (const [name, selector] of [['title', '.mindmap-node-title'], ['subtitle', '.mindmap-node-subtitle']]) {
        const element = node.querySelector(selector); content[name] = element?.textContent || '';
        if (!element) continue;
        const style = getComputedStyle(element), range = document.createRange(); range.selectNodeContents(element);
        if (style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '0') problems.push(name + ': line clamp');
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          if ((buttonStyle.overflowX !== 'visible' && (rect.left < button.left - 1 || rect.right > button.right + 1)) || (buttonStyle.overflowY !== 'visible' && (rect.top < button.top - 1 || rect.bottom > button.bottom + 1))) problems.push(name + ': clipped by button');
          if (rect.left < card.left + 20 || rect.right > card.right - 20 || rect.top < card.top + 9 || rect.bottom > card.bottom - 9) problems.push(name + ': outside decorative safe area');
          if (star && Math.min(star.right, rect.right) - Math.max(star.left, rect.left) > 1 && Math.min(star.bottom, rect.bottom) - Math.max(star.top, rect.top) > 1) problems.push(name + ': overlaps linked-file star');
        }
      }
      return { problems, content, width: node.offsetWidth, height: node.offsetHeight };
    });
    assert.deepEqual(result.problems, [], JSON.stringify(result));
    assert.equal(result.content.title.replace(/\n/g, ''), expectedTitle.replace(/\n/g, ''));
    assert.equal(result.content.subtitle.replace(/\n/g, ''), expectedSubtitle.replace(/\n/g, ''));
    assert.ok(result.height > 96, 'long content must increase the measured card height');
    return result;
  };
  const controlsClear = async () => {
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
      const controls = [...document.querySelectorAll('.mindmap-toolbar button,.mindmap-editor-row input,.mindmap-editor-row textarea,.mindmap-editor-row select,.mindmap-editor-row button,.mindmap-connection-editor input,.mindmap-connection-editor select,.mindmap-export-panel select,.mindmap-export-panel button')];
      const problems = controls.filter(node => node.getClientRects().length).filter(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.bottom > canvas.top + 1; }).map(node => node.className);
      return { problems, width: innerWidth, scroll: document.documentElement.scrollWidth, canvasHeight: canvas.height };
    });
    assert.deepEqual(result.problems, [], JSON.stringify(result)); assert.equal(result.scroll, result.width); assert.ok(result.canvasHeight > 80, JSON.stringify(result));
  };
  const open = async target => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, target);
    await page.locator('#open').click(); await idle();
  };
  try {
    app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), originalFile, '--user-data-dir=' + profile], timeout: 30000 });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-node-id="root"]'); await idle();
    await app.evaluate(({ BrowserWindow, dialog }) => { BrowserWindow.getAllWindows()[0].setContentSize(1280, 960); dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.waitForFunction(() => innerWidth === 1280);
    assert.equal(await page.locator('.mindmap-line-style').isDisabled(), true);
    assert.equal(await page.locator('.mindmap-node-size').isDisabled(), true);
    assert.equal(await page.locator('.mindmap-subtitle-input').getAttribute('readonly'), '');
    await page.locator('#mode').click(); await idle(); await selectNode('a');
    await page.locator('.mindmap-text-input:not(.mindmap-subtitle-input)').fill(longTitle); await page.locator('.mindmap-text-input:not(.mindmap-subtitle-input)').blur();
    await page.locator('.mindmap-subtitle-input').fill(subtitle); await page.locator('.mindmap-subtitle-input').blur();
    const noted = await textFits('a', longTitle, subtitle);
    await undo(); assert.equal(await card('a').locator('.mindmap-node-subtitle').count(), 0);
    await redo(); await textFits('a', longTitle, subtitle);
    for (const size of ['compact', 'standard', 'wide']) {
      await page.locator('.mindmap-node-size').selectOption(size);
      const metrics = await textFits('a', longTitle, subtitle);
      assert.equal(metrics.width, { compact: 180, standard: 216, wide: 320 }[size]);
      if (size === 'wide') assert.ok(metrics.height < noted.height, 'a wider card uses fewer lines');
      for (const value of ['tree', 'vine', 'crystal']) { await theme().selectOption(value); await textFits('a', longTitle, subtitle); }
    }
    await page.locator('.mindmap-node-size').selectOption('standard'); await theme().selectOption('classic');
    for (const style of ['straight', 'orthogonal', 'curve']) {
      await page.locator('.mindmap-line-style').selectOption(style);
      const paths = await page.locator('.mindmap-branch').evaluateAll(lines => lines.map(line => line.getAttribute('d')));
      if (style !== 'curve') assert.ok(paths.every(d => !/[CQ]/.test(d)), style + ': no cubic commands');
      if (style === 'curve') assert.ok(paths.some(d => d.includes(' C ')), 'curve style produces a visible cubic branch');
    }
    await page.locator('.mindmap-line-style').selectOption('orthogonal');
    const offsetLayout = await relativeGeometry(); await page.locator('.mindmap-compact').click(); const compactLayout = await relativeGeometry();
    assert.notDeepEqual(compactLayout, offsetLayout, 'compact layout removes manual offsets'); await undo(); assert.deepEqual(await relativeGeometry(), offsetLayout); await redo();
    await theme().selectOption('crystal');
    console.log('PASS complete long titles and notes, actual browser geometry, all widths and decorated themes, line geometry, compact layout and undo/redo');

    await selectRelation(); await page.locator('.mindmap-edge-style').selectOption('solid'); await page.locator('.mindmap-edge-arrow').selectOption('both'); await page.locator('.mindmap-edge-color').selectOption('#357db4');
    const line = page.locator('[data-connection-line="relation"]');
    assert.equal(await line.evaluate(node => getComputedStyle(node).strokeDasharray), 'none');
    assert.equal(await line.evaluate(node => getComputedStyle(node).stroke), 'rgb(53, 125, 180)');
    assert.ok(await line.getAttribute('marker-start')); assert.ok(await line.getAttribute('marker-end'));
    const arrowGeometry = await line.evaluate(line => {
      const stroke = parseFloat(getComputedStyle(line).strokeWidth), length = line.getTotalLength();
      const inward = ['marker-start', 'marker-end'].reduce((sum, key) => {
        const fragment = /#([^\)]+)\)/.exec(line.getAttribute(key))[1], marker = document.getElementById(fragment);
        const unitScale = marker.getAttribute('markerUnits') === 'userSpaceOnUse' ? 1 : stroke;
        return sum + marker.markerWidth.baseVal.value * unitScale * marker.refX.baseVal.value / marker.viewBox.baseVal.width;
      }, 0);
      return { inward, length };
    });
    assert.ok(arrowGeometry.inward <= arrowGeometry.length, 'short relations need distinguishable arrowheads when selected: ' + JSON.stringify(arrowGeometry));
    await page.locator('.mindmap-connection-input').fill('观察结果支持课程总结'); await page.locator('.mindmap-connection-input').blur();
    await save(); const original = await stored(originalFile);
    assert.equal(original.version, 6); assert.equal(original.lineStyle, 'orthogonal'); assert.equal(original.nodeSize, 'standard');
    assert.equal(original.nodes.find(node => node.id === 'a').text, longTitle); assert.equal(original.nodes.find(node => node.id === 'a').subtitle, subtitle);
    assert.equal(original.connections[0].style, 'solid'); assert.equal(original.connections[0].arrow, 'both'); assert.equal(original.connections[0].color, '#357db4');
    assert.ok(original.nodes.every(node => !node.offset));
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, copyFile);
    await page.keyboard.press('Control+Shift+s'); await idle(); await page.waitForFunction(() => document.querySelector('#document-name').textContent === '课程导图副本.mdmap');
    const copied = await stored(copyFile); assert.equal(copied.nodes.find(node => node.id === 'a').file, '../课程正文.md');
    assert.equal(copied.nodes.find(node => node.id === 'a').subtitle, subtitle); assert.deepEqual(copied.connections, original.connections);
    await page.getByRole('button', { name: '关闭 课程导图副本.mdmap', exact: true }).click(); await idle(); await open(copyFile);
    await page.waitForSelector('[data-node-card="a"]'); await textFits('a', longTitle, subtitle);
    assert.equal(await page.locator('.mindmap-line-style').inputValue(), 'orthogonal'); assert.equal(await page.locator('.mindmap-line-style').isDisabled(), true);
    const readOnlyGeometry = await relativeGeometry(); await selectRelation();
    for (const selector of ['.mindmap-edge-style', '.mindmap-edge-arrow', '.mindmap-edge-color']) assert.equal(await page.locator(selector).isDisabled(), true);
    // A disabled control must not mutate data even if a scripted change event arrives.
    await page.locator('.mindmap-edge-style').evaluate(select => { select.value = 'dashed'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await line.evaluate(node => getComputedStyle(node).strokeDasharray), 'none');
    await undo(); assert.deepEqual(await relativeGeometry(), readOnlyGeometry); assert.equal(await page.locator('#dirty-dot').isVisible(), false);
    assert.deepEqual(await stored(copyFile), copied);
    for (let i = 0; i < 5; i++) await page.locator('#zoom-out').click();
    await page.getByRole('button', { name: '居中', exact: true }).click(); await settle();
    await page.screenshot({ path: path.join(dir, 'light-chinese-overview.png') });
    await page.locator('#zoom-reset').click();
    console.log('PASS relation style/color/arrows, v6 save-as/reopen, rebased file links and read-only protection');

    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, svgFile);
    await page.locator('.mindmap-export').click(); await page.locator('.mindmap-export-format').selectOption('svg'); await page.locator('.mindmap-export-preset').selectOption('16:10');
    await page.locator('.mindmap-export-confirm').click(); await idle();
    const svg = await readFile(svgFile, 'utf8'); assert.match(svg, /<svg/); assert.match(svg, /marker-end/); assert.match(svg, /观察结果支持课程总结/);
    assert.equal(await page.locator('#dirty-dot').isVisible(), false); assert.deepEqual(await stored(copyFile), copied);
    for (const format of ['png', 'pdf']) {
      const destination = path.join(dir, '课程导图.' + format);
      const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
      await page.locator('.mindmap-export').click();
      await page.locator('.mindmap-export-format').selectOption(format);
      await page.locator('.mindmap-export-preset').selectOption('16:10');
      await page.locator('.mindmap-export-confirm').click(); await idle();
      const bytes = await readFile(destination);
      if (format === 'png') {
        assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1200);
      } else {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
        assert.ok(bytes.includes(Buffer.from('/ToUnicode')));
      }
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowsBefore);
      assert.equal(await page.locator('#dirty-dot').isVisible(), false);
      assert.deepEqual(await stored(copyFile), copied);
    }

    await page.locator('#mode').click(); await idle(); await selectNode('a');
    await page.locator('#more-toggle').click(); await page.locator('#theme').click(); await settle();
    assert.equal(await page.locator('.mindmap-canvas').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
    await page.locator('#more-toggle').click(); await page.locator('#settings').click(); await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mindmap-export').textContent(), 'Export');
    for (const selector of ['.mindmap-line-style', '.mindmap-node-size', '.mindmap-edge-style', '.mindmap-edge-arrow', '.mindmap-edge-color']) {
      assert.doesNotMatch((await page.locator(selector).locator('option').allTextContents()).join(' '), /\p{Script=Han}/u, selector);
    }
    for (const width of [1180, 720]) {
      await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value, 900), width); await page.waitForFunction(value => innerWidth === value, width); await settle();
      await selectNode('a'); await controlsClear(); await textFits('a', longTitle, subtitle);
      await page.locator('.mindmap-export').click(); await controlsClear(); await page.locator('.mindmap-export-cancel').click();
      await selectRelation(); await controlsClear(); await selectNode('a');
      await page.screenshot({ path: path.join(dir, `dark-english-${width}.png`) });
    }
    console.log('PASS SVG/PNG/PDF export from read mode, black theme, English controls and narrow-window toolbar/canvas separation');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 960)); await open(noteFile);
    await page.waitForSelector('.tiptap h1'); const originalId = (await page.evaluate(() => window.moye.ready())).id, previousTabs = await page.getByRole('tab').count();
    await page.locator('#outline-to-mindmap').click(); await page.waitForSelector('[data-node-card="root"]'); await idle();
    assert.deepEqual(await page.locator('.mindmap-node-title').allTextContents(), ['基础课程', '观察', '对比', '总结']);
    assert.equal(await page.getByRole('tab').count(), previousTabs + 1, 'conversion adds one new map while preserving every existing tab');
    assert.equal(await readFile(noteFile, 'utf8'), markdown);
    await page.locator('[data-node-id="heading-1"]').dblclick(); await page.waitForSelector('.tiptap h1'); await idle();
    assert.equal((await page.evaluate(() => window.moye.ready())).id, originalId, 'generated node reopens the original Markdown tab');
    assert.equal(await readFile(noteFile, 'utf8'), markdown, 'conversion and navigation never rewrite source body');
    assert.deepEqual(errors, [], 'new mindmap functionality must not raise renderer errors');
    console.log('PASS heading-to-mindmap conversion, fenced-code exclusion and original Markdown/tab preservation');
    console.log('MINDMAP FEEDBACK PASS: ' + dir);
  } catch (error) {
    if (page) { console.error('FEEDBACK DIAGNOSTIC', await page.evaluate(() => ({ document: document.querySelector('#document-name')?.textContent, toast: document.querySelector('#toast')?.textContent, width: innerWidth })).catch(() => null)); await page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {}); }
    throw error;
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
