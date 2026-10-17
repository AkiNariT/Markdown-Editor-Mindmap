const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'mindmap-alignment-'));
  const mapFile = path.join(dir, '拖动参考线与多选移动.mdmap');
  await writeFile(path.join(dir, '关联测试.md'), '# 关联测试\n\n多选节点时不应打开这份文件。\n');
  const node = (id, parent, text, offset = { x: 0, y: 0 }) => ({ id, parent, text, offset, file: null, collapsed: false });
  await writeFile(mapFile, JSON.stringify({
    format: 'md-mindmap', version: 4, root: 'root',
    nodes: [node('root', null, '中心主题'), { ...node('a', 'root', '移动我来对齐', { x: -40, y: -20 }), file: '关联测试.md' }, node('a-child', 'a', '子主题跟随移动', { x: 0, y: -150 }), node('b', 'root', '对齐参考主题', { x: 240, y: 40 }), node('c', 'root', '关系线的另一端', { x: 520, y: -80 })],
    connections: [{ id: 'relation', from: 'a', to: 'c', label: '关系连线绕开中间主题' }],
  }));
  const app = await electron.launch({ executablePath: process.env.MOYE_EXE || require('electron'), args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), mapFile, '--user-data-dir=' + path.join(dir, 'profile')], timeout: 30000 });
  let page;
  const errors = [];
  const idle = () => page.waitForFunction(() => !document.querySelector('#save').disabled);
  const button = name => page.getByRole('button', { name, exact: true });
  const nodeButton = id => page.locator('[data-node-id="' + id + '"]');
  const guide = axis => page.locator('.mindmap-guides line[data-guide-axis="' + axis + '"]');
  const guides = () => page.locator('.mindmap-guides line');
  const selected = () => page.locator('.mindmap-node.mindmap-selected').evaluateAll(cards => cards.map(card => card.dataset.nodeCard).sort());
  const positions = () => page.locator('[data-node-card]').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.nodeCard, {
    x: parseFloat(card.style.left), y: parseFloat(card.style.top), width: card.offsetWidth, height: card.offsetHeight,
  }])));
  const select = async ids => {
    await nodeButton(ids[0]).click();
    for (const id of ids.slice(1)) await nodeButton(id).click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), [...ids].sort(), '修改键点击应建立多选');
  };
  const relativeToRoot = value => Object.fromEntries(Object.entries(value).map(([id, position]) => [id, { x: position.x - value.root.x, y: position.y - value.root.y, width: position.width, height: position.height }]));
  const undo = async () => { await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+z'); };
  const redo = async () => { await page.locator('.mindmap-canvas').focus(); await page.keyboard.press('Control+y'); };
  const save = async () => { await page.locator('#save').click(); await idle(); await page.waitForFunction(() => document.querySelector('#dirty-dot').hidden); };
  const closeTo = (actual, expected, message, tolerance = .6) => assert.ok(Math.abs(actual - expected) < tolerance, message + ': ' + actual + ' vs ' + expected);
  const beginDrag = async (id, dx, dy, alt = false) => {
    const locator = nodeButton(id);
    await locator.scrollIntoViewIfNeeded();
    const rect = await locator.boundingBox();
    assert.equal(await locator.evaluate(element => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, '拖动起点必须实际命中节点');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy, { steps: 8 });
  };
  const endDrag = async (alt = false) => {
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    assert.equal(await guides().count(), 0, '松手后应清除参考线');
    // The app suppresses the synthetic click following pointer-up for 400 ms.
    // Wait before the next independent click so it is a real new interaction.
    await page.waitForTimeout(430);
  };
  const assertLinesClear = async label => {
    const collisions = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-node-card]')].map(card => ({ id: card.dataset.nodeCard, rect: card.getBoundingClientRect() }));
      return [...document.querySelectorAll('.mindmap-branch, [data-connection-line]')].flatMap((line, index) => {
        const length = line.getTotalLength(), transform = line.getScreenCTM(), found = new Set();
        for (let distance = 0; distance <= length; distance += 2) {
          const point = line.getPointAtLength(distance), screen = new DOMPoint(point.x, point.y).matrixTransform(transform);
          for (const { id, rect } of cards) if (screen.x > rect.left + 1 && screen.x < rect.right - 1 && screen.y > rect.top + 1 && screen.y < rect.bottom - 1) found.add(id);
        }
        return [...found].map(node => ({ path: line.dataset.connectionLine || 'branch-' + index, node }));
      });
    });
    assert.deepEqual(collisions, [], label + ': 连线应绕开节点卡片内部');
  };
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-node-id=root]'); await idle();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1000));
    await page.waitForFunction(() => innerWidth === 1400);
    await button('编辑').click(); await idle();
    assert.equal(await button('横向对齐').count(), 0, '拖动对齐应替代旧的横向对齐按钮');
    assert.equal(await button('纵向对齐').count(), 0, '拖动对齐应替代旧的纵向对齐按钮');
    const initial = await positions();
    await nodeButton('a').click();
    await nodeButton('b').click({ modifiers: ['Control'] });
    await nodeButton('c').click({ modifiers: ['Shift'] });
    assert.deepEqual(await selected(), ['a', 'b', 'c'], 'Ctrl 和 Shift 都支持多选');
    await nodeButton('b').click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), ['a', 'c'], '修改键再次点击应取消该节点的选择');
    assert.equal(await page.getByRole('tab').count(), 1, '多选不会打开关联 Markdown 或建立草稿');
    assert.deepEqual(await positions(), initial, '多选本身不能移动节点');
    await nodeButton('a').click();
    await nodeButton('a').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '思维导图菜单', exact: true });
    assert.equal(await menu.locator('[data-action^="align-"]').count(), 0, '右键菜单不再提供旧对齐按钮');
    await page.keyboard.press('Escape');

    const rowDelta = initial.b.y - initial.a.y;
    await beginDrag('a', 0, rowDelta + 3);
    closeTo((await positions()).a.y, initial.b.y, '靠近 3px 时应吸附为同一行');
    assert.ok(await guide('y').count() > 0, '拖动时应出现横向虚线参考线');
    assert.equal(await guide('y').first().evaluate(line => getComputedStyle(line).pointerEvents), 'none', '参考线不应拦截鼠标');
    assert.notEqual(await guide('y').first().evaluate(line => getComputedStyle(line).strokeDasharray), 'none', '参考线必须显示为虚线');
    await page.screenshot({ path: path.join(dir, 'drag-alignment-guides.png') });
    await endDrag();
    const aligned = await positions();
    closeTo(aligned.a.y, initial.b.y, '释放后保持吸附位置');
    closeTo(aligned['a-child'].y - initial['a-child'].y, rowDelta, '子节点应跟随父节点的吸附位移');
    assert.deepEqual(aligned.b, initial.b, '作为参考的节点不应被移动');
    await assertLinesClear('吸附成行后中间主题阻挡关系连线');
    await undo(); assert.deepEqual(await positions(), initial, '一次撤销恢复完整吸附移动');
    await redo(); assert.deepEqual(await positions(), aligned, '一次重做恢复吸附位置');
    await undo();
    console.log('PASS drag-only alignment UI, Ctrl/Shift multi-selection, visible dashed non-intercepting guides, snap, descendants and undo/redo');

    await beginDrag('a', initial.b.x - initial.a.x - 3, 0);
    closeTo((await positions()).a.x, initial.b.x, '靠近另一节点的列时应横向吸附');
    assert.ok(await guide('x').count() > 0, '同一列应出现纵向虚线参考线');
    await page.keyboard.press('Escape');
    assert.equal(await guides().count(), 0, 'Esc 应立即清除参考线');
    assert.deepEqual(await positions(), initial, 'Esc 应取消吸附位置预览');
    await endDrag();

    await beginDrag('a', 17, 31);
    const far = await positions();
    closeTo(far.a.x, initial.a.x + 17, '远离参考位置时保持自由横移');
    closeTo(far.a.y, initial.a.y + 31, '远离参考位置时保持自由纵移');
    assert.equal(await guides().count(), 0, '远离对齐位置不显示参考线');
    await endDrag(); await undo();
    assert.deepEqual(await positions(), initial);
    await beginDrag('a', 0, rowDelta + 3, true);
    closeTo((await positions()).a.y, initial.b.y + 3, 'Alt 临时禁用吸附');
    assert.equal(await guides().count(), 0, 'Alt 自由移动不显示吸附参考线');
    await endDrag(true); await undo();
    assert.deepEqual(await positions(), initial);
    console.log('PASS vertical guide, Escape cancellation, distant free movement and Alt bypass');

    for (let count = 0; count < 5; count++) await page.keyboard.press('Control+=');
    assert.equal(await page.locator('#zoom-reset').textContent(), '150%');
    await beginDrag('a', 0, rowDelta * 1.5 + 5);
    closeTo((await positions()).a.y, initial.b.y, '150% 缩放下 5 个屏幕像素仍应吸附');
    assert.ok(await guide('y').count() > 0);
    await endDrag(); await undo();
    await beginDrag('a', 0, rowDelta * 1.5 + 8);
    closeTo((await positions()).a.y, initial.b.y + 8 / 1.5, '150% 下超过 6 个屏幕像素不得吸附');
    assert.equal(await guide('y').count(), 0, '吸附阈值按屏幕像素，不随缩放放大');
    await endDrag(); await undo();
    await page.keyboard.press('Control+0');
    assert.deepEqual(await positions(), initial);
    console.log('PASS 150% zoom uses a consistent screen-pixel snap threshold');

    await select(['a', 'a-child', 'b']);
    await nodeButton('b').click({ button: 'right' });
    assert.deepEqual(await selected(), ['a', 'a-child', 'b'], '右键选中节点应保留多选');
    await page.keyboard.press('Escape');
    await beginDrag('a', 33, 27);
    await endDrag();
    const dragged = await positions();
    for (const id of ['a', 'a-child', 'b']) {
      closeTo(dragged[id].x - initial[id].x, 33, '群组中的父子节点只横移一次：' + id);
      closeTo(dragged[id].y - initial[id].y, 27, '群组中的父子节点只纵移一次：' + id);
    }
    assert.deepEqual(dragged.c, initial.c, '群组拖动不改变未选节点');
    assert.deepEqual(dragged.root, initial.root, '未选中的根节点保持原位');
    assert.deepEqual(await selected(), ['a', 'a-child', 'b'], '拖动后保留整个选择集');
    await undo(); assert.deepEqual(await positions(), initial, '一次撤销还原整组拖动');
    await redo(); assert.deepEqual(await positions(), dragged, '一次重做恢复整组拖动');
    await undo();
    console.log('PASS multi-select drag preserves relative positions, moves selected parent/child once and supports one-step undo/redo');

    await nodeButton('a').click();
    await beginDrag('a', 0, rowDelta + 3); await endDrag();
    await nodeButton('root').click();
    assert.deepEqual(await selected(), ['root'], '普通点击恢复单选');
    for (const theme of ['classic', 'rounded', 'capsule', 'tree', 'vine', 'crystal']) {
      await page.locator('.mindmap-theme-select').selectOption(theme);
      await assertLinesClear('整图风格 ' + theme);
    }
    await save();
    const saved = JSON.parse(await readFile(mapFile, 'utf8'));
    assert.ok(saved.version >= 2);
    const savedA = saved.nodes.find(item => item.id === 'a');
    closeTo(savedA.offset.y, -20 + rowDelta, '吸附位置保存为普通节点偏移');
    assert.equal(Object.hasOwn(saved, 'guides'), false, '临时参考线不得写入导图');
    const savedPositions = relativeToRoot(await positions());
    await button('关闭 拖动参考线与多选移动.mdmap').click(); await idle();
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, mapFile);
    await button('打开').click(); await page.waitForSelector('[data-node-id=root]'); await idle();
    assert.deepEqual(relativeToRoot(await positions()), savedPositions, '保存重开后保留吸附位置');
    assert.deepEqual(JSON.parse(await readFile(mapFile, 'utf8')), saved, '重开不得改写导图内容');
    assert.equal(await button('编辑').count(), 1, '重新打开导图应处于阅读模式');
    const readOnly = await positions();
    await beginDrag('a', 42, 19); await endDrag();
    assert.deepEqual(await positions(), readOnly, '阅读模式不能移动节点');
    assert.equal(await guides().count(), 0, '阅读模式不显示吸附参考线');
    await assertLinesClear('保存重开');
    await page.screenshot({ path: path.join(dir, 'reopened-read-mode.png') });
    assert.deepEqual(errors, [], '导图交互不应产生 renderer 错误');
    console.log('PASS obstacle-free solid/dashed connectors across all six styles, saved/reopened snap offsets and read-only protection');
    console.log('MINDMAP ALIGNMENT PASS: ' + dir);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
