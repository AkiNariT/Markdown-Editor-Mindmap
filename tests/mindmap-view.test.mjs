import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://moye.local' });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const imported = await import('../src/mindmap-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const base = () => ({ format: 'md-mindmap', version: 1, root: 'root', nodes: [
  { id: 'root', parent: null, text: '中心主题', file: null, collapsed: false },
] });
function setup(data = base(), options = {}) {
  assert.equal(typeof imported.createMindmapView, 'function', 'mindmap view factory must exist');
  const changes = [], errors = [];
  const view = imported.createMindmapView(data, { onChange: () => changes.push(view.getData()), onError: message => errors.push(message), ...options });
  document.body.append(view.host);
  return { view, changes, errors, close() { view.destroy(); view.host.remove(); } };
}
function button(view, name) { return [...view.host.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === name); }
function input(view, value, options = {}) {
  const element = view.host.querySelector('[aria-label="节点文字"]');
  element.focus(); element.value = value;
  element.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, ...options }));
  return element;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const branch = () => ({ ...base(), nodes: [...base().nodes,
  { id: 'a', parent: 'root', text: '主题 A', file: null, collapsed: false },
  { id: 'b', parent: 'a', text: '主题 B', file: null, collapsed: false },
] });
const nodeButton = (view, id) => view.host.querySelector(`[data-node-id="${id}"]`);
const point = (view, id) => { const card = nodeButton(view, id).closest('.mindmap-node'); return { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }; };
function pointer(target, type, x, y) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
}
function startDrag(view, id, x = 200, y = 200) { pointer(nodeButton(view, id), 'pointerdown', x, y); }
function moveDrag(view, x, y, type = 'pointermove') { pointer(view.host.querySelector('.mindmap-canvas'), type, x, y); }
function context(view, id = null) {
  const target = id ? nodeButton(view, id) : view.host.querySelector('.mindmap-canvas');
  target.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }));
  return view.host.querySelector('[role="menu"]');
}
function menuAction(view, action) { return view.host.querySelector(`[role="menu"] [data-action="${action}"]`); }

function choosePalette(view, value) {
  const swatch = view.host.querySelector('[data-palette="' + value + '"]');
  assert.ok(swatch, 'fixed palettes are directly available'); swatch.click(); return swatch;
}

test('reading exposes only relevant navigation controls and editing restores the full toolbar', () => {
  const data = branch(); data.nodes[1].file = 'C:/notes/a.md';
  const fixture = setup(data, { onOpen: () => {}, onLink: () => {}, onEdit: () => {} });
  const { view } = fixture;
  const visibleTools = () => [...view.host.querySelectorAll('.mindmap-toolbar button')].filter(element => !element.hidden).map(element => element.textContent);
  try {
    const before = view.getText(), positions = data.nodes.map(item => point(view, item.id));
    view.setEditable(false);
    assert.equal(view.host.querySelector('.mindmap-editor-row').hidden, true);
    assert.deepEqual(visibleTools(), ['居中', '导出']);
    assert.match(view.host.querySelector('.mindmap-hint').textContent, /双击节点打开文件/);
    nodeButton(view, 'a').click();
    assert.deepEqual(visibleTools(), ['打开文件', '居中', '导出']);
    context(view, 'a'); assert.equal(menuAction(view, 'edit-map').disabled, false);
    view.setEditable(true);
    assert.equal(view.host.querySelector('.mindmap-editor-row').hidden, false);
    assert.deepEqual(visibleTools(), ['子主题', '同级主题', '删除', '关联 Markdown', '打开文件', '取消关联', '折叠', '整理布局', '居中', '导出']);
    assert.equal(view.host.querySelector('[aria-label="节点文字"]').readOnly, false);
    assert.equal(view.host.querySelector('[data-palette=blue]').disabled, false);
    assert.match(view.host.querySelector('.mindmap-hint').textContent, /拖动节点靠近时对齐/);
    assert.equal(nodeButton(view, 'a').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(data.nodes.map(item => point(view, item.id)), positions);
    assert.equal(view.getText(), before); assert.equal(fixture.changes.length, 0);
  } finally { fixture.close(); }
});

test('changing reading chrome preserves node screen positions by compensating canvas origin changes', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    canvas.getBoundingClientRect = () => ({ left: 40, top: view.host.classList.contains('mindmap-readonly') ? 50 : 120 });
    canvas.scrollLeft = 180; canvas.scrollTop = 200;
    const before = point(view, 'a');
    view.setEditable(false);
    assert.equal(canvas.scrollLeft, 180); assert.equal(canvas.scrollTop, 130);
    assert.deepEqual(point(view, 'a'), before);
    view.setEditable(true);
    assert.equal(canvas.scrollLeft, 180); assert.equal(canvas.scrollTop, 200);
    assert.deepEqual(point(view, 'a'), before); assert.equal(fixture.changes.length, 0);
  } finally { fixture.close(); }
});

test('session recovery restores selection and independent viewport without altering data or undo history', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    input(view, '新的中心主题');
    nodeButton(view, 'a').click();
    const canvas = view.host.querySelector('.mindmap-canvas');
    canvas.scrollLeft = 180; canvas.scrollTop = 220;
    view.capturePosition();
    const saved = view.captureSessionState(), before = view.getText(), changes = fixture.changes.length;
    assert.deepEqual(saved, { selected: 'a', position: { left: 180, top: 220 }, layoutPadding: { x: 400, y: 250 } });
    saved.position.left = 900;
    saved.layoutPadding.x = 900;
    assert.equal(view.captureSessionState().position.left, 180, 'session snapshots must be independent');
    assert.equal(view.captureSessionState().layoutPadding.x, 400);
    view.setEditable(false); view.setLocked(true);
    assert.equal(view.restoreSessionState({ selected: 'b', position: { left: 360, top: 280 } }), true);
    assert.equal(nodeButton(view, 'b').getAttribute('aria-pressed'), 'true');
    assert.equal(canvas.scrollLeft, 360); assert.equal(canvas.scrollTop, 280);
    assert.equal(view.getText(), before); assert.equal(fixture.changes.length, changes);
    assert.equal(view.undo(), false, 'recovery cannot weaken editing protections');
    view.setLocked(false); view.setEditable(true); view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
    assert.equal(view.undo(), false, 'restoring view state must not add a history entry');
  } finally { fixture.close(); }
});

test('hidden canvases retain their saved viewport through checkpoint capture and scroll events', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas'); let visible = true;
    Object.defineProperty(canvas, 'clientWidth', { get: () => visible ? 1000 : 0 });
    Object.defineProperty(canvas, 'clientHeight', { get: () => visible ? 600 : 0 });
    view.setSaved(view.getData());
    canvas.scrollLeft = 180; canvas.scrollTop = 220;
    assert.deepEqual(view.captureSessionState().position, { left: 180, top: 220 }, 'visible checkpoints capture live viewport movement');
    visible = false;
    canvas.scrollLeft = 0; canvas.scrollTop = 0;
    assert.deepEqual(view.captureSessionState().position, { left: 180, top: 220 }, 'a connected but hidden canvas cannot overwrite its saved viewport');
    canvas.dispatchEvent(new dom.window.Event('scroll'));
    assert.deepEqual(view.captureSessionState().position, { left: 180, top: 220 }, 'hidden scroll events must not replace the saved viewport');
    visible = true; view.restorePosition();
    assert.equal(canvas.scrollLeft, 180); assert.equal(canvas.scrollTop, 220);
    canvas.scrollLeft = 300; canvas.scrollTop = 180;
    canvas.dispatchEvent(new dom.window.Event('scroll'));
    assert.deepEqual(view.captureSessionState().position, { left: 300, top: 180 });
    assert.equal(fixture.changes.length, 0); assert.equal(view.undo(), false);
  } finally { fixture.close(); }
});

test('session recovery validates selection and scroll values and survives mounting later', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    view.host.remove();
    view.restoreSessionState({ selected: 'b', position: { left: 200, top: 180 } });
    assert.deepEqual(view.captureSessionState(), { selected: 'b', position: { left: 200, top: 180 }, layoutPadding: { x: 400, y: 250 } });
    document.body.append(view.host); view.restorePosition();
    assert.equal(nodeButton(view, 'b').getAttribute('aria-pressed'), 'true');
    assert.equal(canvas.scrollLeft, 200); assert.equal(canvas.scrollTop, 180);
    for (const position of [{ left: -1, top: 50 }, { left: Infinity, top: 50 }, { left: 50, top: NaN }, { left: '20', top: 50 }]) {
      view.restoreSessionState({ selected: 'missing', position });
      assert.deepEqual(view.captureSessionState(), { selected: 'b', position: { left: 200, top: 180 }, layoutPadding: { x: 400, y: 250 } });
    }
    for (const value of [null, [], 'invalid']) assert.equal(view.restoreSessionState(value), false);
    Object.defineProperty(canvas, 'clientWidth', { value: 500 });
    Object.defineProperty(canvas, 'clientHeight', { value: 300 });
    Object.defineProperty(canvas, 'scrollWidth', { value: 1500 });
    Object.defineProperty(canvas, 'scrollHeight', { value: 900 });
    view.restoreSessionState({ selected: 'a', position: { left: 1e12, top: 1e12 } });
    assert.equal(canvas.scrollLeft, 1000); assert.equal(canvas.scrollTop, 600);
    assert.equal(fixture.changes.length, 0);
  } finally { fixture.close(); }
});

test('recovery at a saved zoom preserves layout originally initialized at a different zoom', () => {
  const original = setup(branch()), restored = setup(branch());
  const sizeCanvas = view => {
    const canvas = view.host.querySelector('.mindmap-canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1000 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    return canvas;
  };
  try {
    const firstCanvas = sizeCanvas(original.view);
    original.view.setSaved(original.view.getData());
    original.view.setZoom(120); nodeButton(original.view, 'a').click();
    firstCanvas.scrollLeft = 180; firstCanvas.scrollTop = 180;
    const saved = original.view.captureSessionState();
    assert.deepEqual(point(original.view, 'a'), { x: 792, y: 300 });
    const secondCanvas = sizeCanvas(restored.view);
    restored.view.setZoom(120); restored.view.restoreSessionState(saved);
    assert.deepEqual(point(restored.view, 'a'), { x: 792, y: 300 }, 'restoring zoom must not derive new layout padding');
    assert.equal(secondCanvas.scrollLeft, 180); assert.equal(secondCanvas.scrollTop, 180);
    assert.equal(nodeButton(restored.view, 'a').getAttribute('aria-pressed'), 'true');
    assert.equal(restored.view.getText(), original.view.getText());
    assert.equal(restored.changes.length, 0); assert.equal(restored.view.undo(), false);
  } finally { original.close(); restored.close(); }
});

test('restored layout padding is applied before mounting and rejects invalid or excessive values', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    view.host.remove();
    view.setZoom(150);
    view.restoreSessionState({ selected: 'a', position: { left: 100, top: 100 }, layoutPadding: { x: 600, y: 350 } });
    Object.defineProperty(canvas, 'clientWidth', { value: 1000 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    document.body.append(view.host); view.restorePosition();
    assert.deepEqual(point(view, 'a'), { x: 892, y: 350 });
    view.setSaved(view.getData());
    assert.deepEqual(point(view, 'a'), { x: 892, y: 350 }, 'the first measured render must retain restored padding');
    for (const layoutPadding of [{ x: -1, y: 50 }, { x: Infinity, y: 50 }, { x: 20, y: NaN }, { x: '20', y: 50 }, { x: 1e6 + 1, y: 50 }]) {
      view.restoreSessionState({ layoutPadding });
      assert.deepEqual(point(view, 'a'), { x: 892, y: 350 });
    }
    assert.deepEqual(view.captureSessionState().layoutPadding, { x: 600, y: 350 });
    assert.equal(fixture.changes.length, 0);
  } finally { fixture.close(); }
});

test('session recovery cannot interrupt an active composition or restore a destroyed view', () => {
  const fixture = setup(branch()); const { view } = fixture;
  try {
    const text = input(view, '中心主题');
    text.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    input(view, 'zhong', { isComposing: true });
    assert.equal(view.restoreSessionState({ selected: 'a', position: { left: 100, top: 100 } }), false);
    assert.equal(text.value, 'zhong');
    assert.equal(nodeButton(view, 'root').getAttribute('aria-pressed'), 'true');
    text.value = '中'; text.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    view.undo(); assert.equal(view.getData().nodes[0].text, '中心主题');
    view.destroy();
    assert.equal(view.restoreSessionState({ selected: 'a', position: { left: 100, top: 100 } }), false);
  } finally { fixture.close(); }
});

test('double-clicking a linked title or card opens its own Markdown in reading and editing modes', async () => {
  const data = branch(); data.nodes[1].file = 'C:/notes/a.md';
  const opened = [], fixture = setup(data, { onOpen: id => opened.push(id) });
  const { view, changes } = fixture;
  const doubleClick = target => target.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
  try {
    for (const editable of [false, true]) {
      view.setEditable(editable);
      doubleClick(nodeButton(view, 'a').querySelector('.mindmap-node-title')); await tick();
      doubleClick(nodeButton(view, 'a').closest('.mindmap-node')); await tick();
    }
    assert.deepEqual(opened, ['a', 'a', 'a', 'a']);
    assert.equal(changes.length, 0, 'opening a node does not modify the map');
    assert.notEqual(document.activeElement, view.host.querySelector('[aria-label="节点文字"]'));
  } finally { fixture.close(); }
});

test('double-click creates unlinked files and does not bypass interaction protections or nested controls', async () => {
  const data = branch(); data.nodes[1].file = 'C:/notes/a.md';
  const opened = [], created = [], fixture = setup(data, { onOpen: id => opened.push(id), onCreate: async id => { created.push(id); return null; } });
  const { view } = fixture;
  const doubleClick = target => target.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
  try {
    doubleClick(nodeButton(view, 'b')); await tick(); assert.deepEqual(created, ['b']); assert.notEqual(document.activeElement, view.host.querySelector('[aria-label="节点文字"]'));
    view.host.querySelector('.mindmap-canvas').focus(); view.setEditable(false);
    doubleClick(nodeButton(view, 'b')); await tick(); assert.deepEqual(created, ['b', 'b']); assert.notEqual(document.activeElement, view.host.querySelector('[aria-label="节点文字"]'));
    view.setEditable(true); view.setLocked(true); doubleClick(nodeButton(view, 'a')); await tick(); assert.deepEqual(opened, []);
    view.setLocked(false);
    const text = input(view, '主题 B'); text.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    doubleClick(nodeButton(view, 'a')); await tick(); assert.deepEqual(opened, []);
    text.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    context(view, 'root'); menuAction(view, 'connect').click(); doubleClick(nodeButton(view, 'a')); await tick(); assert.deepEqual(opened, []);
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doubleClick(view.host.querySelector('[data-open-node="a"]')); doubleClick(nodeButton(view, 'a').closest('.mindmap-node').querySelector('.mindmap-fold'));
    await tick(); assert.deepEqual(opened, [], 'star/fold double-click must not bubble into a second file open');
    view.host.querySelector('[data-open-node="a"]').click(); await tick(); assert.deepEqual(opened, ['a']);
    startDrag(view, 'a'); moveDrag(view, 240, 230); moveDrag(view, 240, 230, 'pointerup'); doubleClick(nodeButton(view, 'a')); await tick();
    assert.deepEqual(opened, ['a'], 'releasing a drag must not open the linked file');
  } finally { fixture.close(); }
});

test('double-clicking a connection destination completes the link without opening its Markdown', async () => {
  const data = branch(); data.nodes[1].file = 'C:/notes/a.md';
  const opened = [], fixture = setup(data, { onOpen: id => opened.push(id) });
  const { view } = fixture;
  try {
    context(view, 'root'); menuAction(view, 'connect').click();
    nodeButton(view, 'a').click();
    pointer(nodeButton(view, 'a'), 'pointerdown', 200, 200); pointer(nodeButton(view, 'a'), 'pointerup', 200, 200);
    nodeButton(view, 'a').click();
    nodeButton(view, 'a').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    await tick(); assert.equal(view.getData().connections.length, 1); assert.deepEqual(opened, []);
  } finally { fixture.close(); }
});

test('palette commits once, persists after saving, and reset restores both automatic colors', () => {
  const state = setup(), { view } = state; let reopened;
  try {
    choosePalette(view, 'blue'); assert.equal(state.changes.length, 1);
    const painted = view.getData(); assert.equal(painted.version, 4); assert.equal(painted.nodes[0].color, '#1e3a5f');
    assert.equal(painted.nodes[0].background, '#dbeafe');
    view.setSaved(JSON.parse(view.getText())); reopened = setup(JSON.parse(view.getText()));
    assert.deepEqual(reopened.view.getData(), painted);
    assert.equal(reopened.view.host.querySelector('[data-palette=blue]').getAttribute('aria-pressed'), 'true');
    view.undo(); assert.equal(view.getData().nodes[0].color, undefined); assert.equal(view.undo(), false);
    view.redo(); choosePalette(view, 'default'); assert.equal(view.getData().nodes[0].color, undefined); assert.equal(view.getData().nodes[0].background, undefined);
    view.undo(); assert.deepEqual(view.getData(), painted); assert.deepEqual(state.errors, []);
  } finally { reopened?.close(); state.close(); }
});

test('palette edits respect selection, read-only mode, locking and Chinese composition', () => {
  const state = setup(branch()), { view } = state;
  try {
    nodeButton(view, 'a').click(); choosePalette(view, 'green'); const painted = view.getText();
    assert.equal(view.getData().nodes[0].color, undefined); assert.equal(view.getData().nodes[1].color, '#244b35');
    for (const mode of ['readonly', 'locked', 'composition']) {
      const text = view.host.querySelector('[aria-label="节点文字"]');
      if (mode === 'readonly') view.setEditable(false);
      else if (mode === 'locked') view.setLocked(true);
      else text.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
      assert.equal(view.host.querySelector('[data-palette=blue]').disabled, true);
      choosePalette(view, 'blue'); choosePalette(view, 'default'); assert.equal(view.getText(), painted);
      if (mode === 'readonly') view.setEditable(true);
      else if (mode === 'locked') view.setLocked(false);
      else text.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    }
    assert.equal(state.changes.length, 1); view.undo(); assert.equal(view.getData().nodes[1].color, undefined);
  } finally { state.close(); }
});

test('dragging and connecting preset nodes preserve both colors and version four', () => {
  const state = setup(branch()), { view } = state;
  try {
    nodeButton(view, 'a').click(); choosePalette(view, 'blue');
    startDrag(view, 'a'); moveDrag(view, 250, 230); moveDrag(view, 250, 230, 'pointerup');
    assert.equal(view.getData().version, 4); assert.deepEqual(view.getData().nodes[1].offset, { x: 50, y: 30 });
    context(view, 'a'); menuAction(view, 'connect').click(); nodeButton(view, 'root').click();
    assert.equal(view.getData().connections.length, 1); assert.equal(view.getData().nodes[1].background, '#dbeafe');
    view.undo(); view.undo(); assert.equal(view.getData().nodes[1].offset, undefined);
    assert.equal(view.getData().nodes[1].color, '#1e3a5f'); assert.equal(view.getData().nodes[1].background, '#dbeafe');
    assert.deepEqual(state.errors, []);
  } finally { state.close(); }
});

test('linked stars open their own file without dragging and unlinked nodes show no marker', async () => {
  const data = branch(); data.nodes[1].file = 'C:\\notes\\a.md';
  const opened = [];
  const state = setup(data, { onOpen: async id => opened.push(id) }); const { view } = state;
  try {
    const root = nodeButton(view, 'root').closest('.mindmap-node');
    assert.equal(root.textContent, '中心主题−', 'an unlinked node has no attachment placeholder');
    assert.doesNotMatch(view.host.textContent, /未关联/);
    assert.equal(view.host.querySelector('.mindmap-selection-detail').hidden, true);
    const star = view.host.querySelector('.mindmap-file');
    assert.equal(star.textContent, '★');
    assert.equal(star.getAttribute('aria-label'), '打开关联文件：a.md');
    assert.equal(star.title, 'C:\\notes\\a.md');
    const before = point(view, 'a');
    pointer(star, 'pointerdown', 200, 200); moveDrag(view, 280, 260); moveDrag(view, 280, 260, 'pointerup');
    star.click(); await tick();
    assert.deepEqual(point(view, 'a'), before);
    assert.deepEqual(opened, ['a']);
    assert.equal(nodeButton(view, 'root').getAttribute('aria-pressed'), 'true');
    assert.equal(state.changes.length, 0);
    view.setEditable(false); star.click(); await tick(); assert.deepEqual(opened, ['a', 'a']);
    view.setLocked(true); star.click(); await tick(); assert.deepEqual(opened, ['a', 'a']);
  } finally { state.close(); }
});

test('drag previews a whole branch at world scale and commits a single undo step', () => {
  const state = setup(branch()); const { view } = state;
  try {
    view.setZoom(200);
    const a = point(view, 'a'), b = point(view, 'b'), root = point(view, 'root');
    const line = view.host.querySelector('.mindmap-lines path').getAttribute('d');
    startDrag(view, 'a'); moveDrag(view, 260, 240); moveDrag(view, 280, 260);
    assert.deepEqual(point(view, 'a'), { x: a.x + 40, y: a.y + 30 });
    assert.deepEqual(point(view, 'b'), { x: b.x + 40, y: b.y + 30 });
    assert.deepEqual(point(view, 'root'), root);
    assert.notEqual(view.host.querySelector('.mindmap-lines path').getAttribute('d'), line);
    assert.equal(view.getData().nodes[1].offset, undefined, 'uncommitted preview cannot leak into saving');
    assert.equal(JSON.parse(view.getText()).version, 1);
    assert.equal(state.changes.length, 0);
    moveDrag(view, 280, 260, 'pointerup');
    assert.equal(view.getData().version, 2);
    assert.deepEqual(view.getData().nodes[1].offset, { x: 40, y: 30 });
    assert.equal(view.getData().nodes[2].offset, undefined);
    assert.equal(state.changes.length, 1);
    view.undo(); assert.deepEqual(point(view, 'a'), a); assert.equal(view.getData().version, 1);
    assert.equal(view.undo(), false);
    view.redo(); assert.deepEqual(point(view, 'b'), { x: b.x + 40, y: b.y + 30 });
    const copy = view.getData(); copy.nodes[1].offset.x = 999;
    assert.equal(view.getData().nodes[1].offset.x, 40, 'callers cannot mutate offset history');
  } finally { state.close(); }
});

test('small pointer motion stays a click and drag cancellation leaves data and history intact', () => {
  for (const cancel of ['pointercancel', 'lostpointercapture', 'Escape', 'readonly', 'zoom']) {
    const state = setup(branch()); const { view } = state;
    try {
      const before = point(view, 'a');
      startDrag(view, 'a'); moveDrag(view, 202, 201); moveDrag(view, 202, 201, 'pointerup');
      assert.equal(state.changes.length, 0); assert.deepEqual(point(view, 'a'), before);
      startDrag(view, 'a'); moveDrag(view, 300, 300);
      assert.notDeepEqual(point(view, 'a'), before, 'cancel must discard an actual preview');
      if (cancel === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (cancel === 'readonly') view.setEditable(false);
      else if (cancel === 'zoom') view.setZoom(150);
      else moveDrag(view, 300, 300, cancel);
      assert.deepEqual(point(view, 'a'), before, cancel);
      assert.deepEqual(view.getData(), branch(), cancel);
      assert.equal(state.changes.length, 0, cancel);
    } finally { state.close(); }
  }
});

test('node pointer capture starts only after the drag threshold so clicks and double-clicks keep their target', async () => {
  const created = [], state = setup(base(), { onCreate: async id => { created.push(id); return null; } }); const { view } = state;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    let captured = null;
    canvas.setPointerCapture = id => { captured = id; };
    canvas.hasPointerCapture = id => captured === id;
    canvas.releasePointerCapture = () => { captured = null; };
    startDrag(view, 'root'); assert.equal(captured, null);
    moveDrag(view, 202, 201); assert.equal(captured, null);
    moveDrag(view, 202, 201, 'pointerup');
    nodeButton(view, 'root').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    await tick(); assert.deepEqual(created, ['root']);
    startDrag(view, 'root'); moveDrag(view, 220, 230); assert.equal(captured, 1);
    moveDrag(view, 220, 230, 'pointerup'); assert.equal(captured, null);
    nodeButton(view, 'root').dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    await tick(); assert.equal(document.activeElement, canvas, 'drag must not become a file creation'); assert.deepEqual(created, ['root']);
  } finally { state.close(); }
});

test('scrolling a long context menu keeps the menu open while canvas scroll closes it', () => {
  const state = setup(); const { view } = state;
  try {
    const menu = context(view, 'root');
    assert.ok(menu);
    menu.dispatchEvent(new dom.window.Event('scroll'));
    assert.equal(view.host.querySelector('[role="menu"]'), menu);
    const canvas = view.host.querySelector('.mindmap-canvas'); canvas.scrollLeft += 20;
    canvas.dispatchEvent(new dom.window.Event('scroll'));
    assert.equal(view.host.querySelector('[role="menu"]'), null);
  } finally { state.close(); }
});

test('root motion persists through collapse and new children inherit the branch offset', () => {
  const state = setup(branch()); const { view } = state;
  try {
    startDrag(view, 'a'); moveDrag(view, 260, 240); moveDrag(view, 260, 240, 'pointerup');
    context(view, 'a'); menuAction(view, 'toggle').click();
    context(view, 'a'); menuAction(view, 'toggle').click();
    assert.deepEqual(view.getData().nodes[1].offset, { x: 60, y: 40 });
    context(view, 'a'); menuAction(view, 'add-child').click();
    const childId = view.getData().nodes.at(-1).id;
    const before = point(view, childId);
    startDrag(view, 'root'); moveDrag(view, 270, 280); moveDrag(view, 270, 280, 'pointerup');
    assert.deepEqual(point(view, childId), { x: before.x + 70, y: before.y + 80 });
    assert.equal(view.getData().nodes.at(-1).offset, undefined);
    assert.equal(view.getData().nodes.at(-1).parent, 'a');
  } finally { state.close(); }
});

test('drag grows the canvas past the top left and expands the stage toward the bottom right', () => {
  const state = setup(branch()); const { view } = state;
  try {
    const before = point(view, 'root'), canvas = view.host.querySelector('.mindmap-canvas');
    const initialWidth = parseFloat(view.host.querySelector('.mindmap-stage').style.width);
    startDrag(view, 'root'); moveDrag(view, -5000, -5000); moveDrag(view, -5000, -5000, 'pointerup');
    const moved = point(view, 'root');
    assert.deepEqual({ x: moved.x - canvas.scrollLeft, y: moved.y - canvas.scrollTop }, { x: before.x - 5200, y: before.y - 5200 });
    startDrag(view, 'b'); moveDrag(view, 5000, 5000); moveDrag(view, 5000, 5000, 'pointerup');
    assert.ok(parseFloat(view.host.querySelector('.mindmap-stage').style.width) > initialWidth + 3000);
    assert.equal(state.errors.length, 0);
  } finally { state.close(); }
});

test('node context menu selects its target and reuses linking, editing and reset history', async () => {
  const linked = [];
  const state = setup(branch(), { onLink: async id => { linked.push(id); return 'C:\\notes\\a.md'; } }); const { view } = state;
  try {
    assert.ok(context(view, 'a'), 'right-click must expose a local menu');
    assert.equal(nodeButton(view, 'a').getAttribute('aria-pressed'), 'true');
    menuAction(view, 'link-markdown').click(); await tick();
    assert.deepEqual(linked, ['a']); assert.equal(view.getData().nodes[1].file, 'C:\\notes\\a.md');
    assert.equal(view.host.querySelector('[role="menu"]'), null);
    context(view, 'a'); menuAction(view, 'edit').click();
    assert.equal(document.activeElement, view.host.querySelector('.mindmap-text-input'));
    startDrag(view, 'a'); moveDrag(view, 240, 230); moveDrag(view, 240, 230, 'pointerup');
    context(view, 'a'); menuAction(view, 'reset-layout').click();
    assert.equal(view.getData().nodes[1].offset, undefined);
    view.undo(); assert.deepEqual(view.getData().nodes[1].offset, { x: 40, y: 30 });
    const menu = context(view); assert.match(menu.textContent, /主题 A/);
    menuAction(view, 'add-child').click(); assert.equal(view.getData().nodes.at(-1).parent, 'a');
  } finally { state.close(); }
});

test('context menu closes on outside click, Escape, scroll, resize and editing changes', () => {
  const state = setup(); const { view } = state;
  try {
    for (const reason of ['outside', 'Escape', 'scroll', 'resize', 'readonly']) {
      view.setEditable(true); assert.ok(context(view, 'root'));
      if (reason === 'outside') document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
      else if (reason === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (reason === 'scroll') { const canvas = view.host.querySelector('.mindmap-canvas'); canvas.scrollTop += 20; canvas.dispatchEvent(new dom.window.Event('scroll')); }
      else if (reason === 'resize') dom.window.dispatchEvent(new dom.window.Event('resize'));
      else view.setEditable(false);
      assert.equal(view.host.querySelector('[role="menu"]'), null, reason);
    }
    const nativeEvent = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    view.host.querySelector('.mindmap-text-input').dispatchEvent(nativeEvent);
    assert.equal(nativeEvent.defaultPrevented, false);
  } finally { state.close(); }
});

test('read-only menus can request edit mode and frozen views cannot pan, open or mutate', async () => {
  const data = branch(); data.nodes[1].file = 'C:\\notes\\a.md';
  let editCalls = 0; const opened = [];
  const state = setup(data, { onEdit: async () => { editCalls++; }, onOpen: async id => opened.push(id) }); const { view } = state;
  try {
    view.setEditable(false); const before = point(view, 'a');
    startDrag(view, 'a'); moveDrag(view, 300, 300); moveDrag(view, 300, 300, 'pointerup');
    assert.deepEqual(point(view, 'a'), before);
    context(view, 'a'); assert.ok(menuAction(view, 'edit-map'));
    assert.equal(menuAction(view, 'link-markdown').disabled, true);
    menuAction(view, 'edit-map').click(); await tick(); assert.equal(editCalls, 1);
    context(view, 'a'); menuAction(view, 'open').click(); await tick(); assert.deepEqual(opened, ['a']);
    view.setEditable(true); assert.equal(view.setLocked(true), true);
    const canvas = view.host.querySelector('.mindmap-canvas');
    canvas.scrollLeft = 400; pointer(canvas, 'pointerdown', 200, 200); moveDrag(view, 300, 300); moveDrag(view, 300, 300, 'pointerup');
    assert.equal(canvas.scrollLeft, 400);
    assert.equal(context(view, 'a'), null);
    view.host.querySelector('.mindmap-file').click(); await tick(); assert.deepEqual(opened, ['a']);
    input(view, '不应写入'); assert.equal(view.getData().nodes[1].text, '主题 A');
    assert.equal(state.changes.length, 0);
  } finally { state.close(); }
});

test('connect mode makes independent node relations without changing the tree and follows dragged endpoints', () => {
  const state = setup(branch()); const { view } = state;
  try {
    context(view, 'root'); assert.ok(menuAction(view, 'connect')); menuAction(view, 'connect').click();
    nodeButton(view, 'b').click();
    const data = view.getData();
    assert.equal(data.version, 2); assert.equal(data.nodes[2].parent, 'a');
    assert.equal(data.connections.length, 1);
    assert.equal(data.connections[0].from, 'root'); assert.equal(data.connections[0].to, 'b');
    const connectionId = data.connections[0].id;
    const line = view.host.querySelector(`[data-connection-line="${connectionId}"]`).getAttribute('d');
    startDrag(view, 'b'); moveDrag(view, 260, 230); moveDrag(view, 260, 230, 'pointerup');
    assert.notEqual(view.host.querySelector(`[data-connection-line="${connectionId}"]`).getAttribute('d'), line);
    context(view, 'b'); menuAction(view, 'connect').click(); nodeButton(view, 'root').click();
    assert.equal(view.getData().connections.length, 1); assert.equal(state.errors.length, 1);
    nodeButton(view, 'b').click(); assert.equal(view.getData().connections.length, 1); assert.equal(state.errors.length, 2);
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(view.host.classList.contains('mindmap-connecting'), false);
    const hit = view.host.querySelector(`[data-connection-id="${connectionId}"]`);
    hit.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 350, clientY: 250 }));
    menuAction(view, 'delete-connection').click(); assert.equal(view.getData().connections.length, 0);
    view.undo(); assert.equal(view.getData().connections[0].id, connectionId);
    view.host.querySelector(`[data-connection-id="${connectionId}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    view.host.querySelector('.mindmap-canvas').dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    assert.equal(view.getData().connections.length, 0);
  } finally { state.close(); }
});

test('deleting a subtree deletes attached connections in the same undo transaction', () => {
  const state = setup(branch()); const { view } = state;
  try {
    context(view, 'root'); assert.ok(menuAction(view, 'connect')); menuAction(view, 'connect').click(); nodeButton(view, 'b').click();
    const id = view.getData().connections[0].id;
    context(view, 'a'); menuAction(view, 'delete').click(); button(view, '确认删除').click();
    assert.equal(view.getData().nodes.length, 1); assert.equal(view.getData().connections.length, 0);
    view.undo(); assert.equal(view.getData().nodes.length, 3); assert.equal(view.getData().connections[0].id, id);
  } finally { state.close(); }
});

test('tree lines use the facing node edges after nodes are moved left of their parent', () => {
  // Hide the grandchild: after this large reverse drag it would cover the
  // root's left port and correctly force obstacle routing to another edge.
  const data = branch(); data.nodes[1].collapsed = true;
  const state = setup(data); const { view } = state;
  try {
    startDrag(view, 'a'); moveDrag(view, -420, 200); moveDrag(view, -420, 200, 'pointerup');
    const root = point(view, 'root'), a = point(view, 'a');
    const values = view.host.querySelector('.mindmap-lines path').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(values[0], root.x);
    assert.equal(values.at(-2), a.x + 216);
  } finally { state.close(); }
});

test('a connection between a parent and child has a visible curve apart from the tree line', () => {
  const state = setup(branch()); const { view } = state;
  try {
    context(view, 'root'); menuAction(view, 'connect').click(); nodeButton(view, 'a').click();
    const values = view.host.querySelector('[data-connection-line]').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.notEqual(values[3], values[1], 'relation curve must not overlap the straight tree edge');
  } finally { state.close(); }
});

for (const axis of ['vertical', 'horizontal']) {
  for (const reverse of [false, true]) {
    test(`short ${axis} connections keep control points between facing edges${reverse ? ' in reverse direction' : ''}`, () => {
      const data = branch(); data.version = 2; data.nodes[2].parent = 'root';
      if (axis === 'horizontal') data.nodes[2].offset = { x: 240, y: -120 };
      data.connections = [{ id: 'short-gap', from: reverse ? 'b' : 'a', to: reverse ? 'a' : 'b' }];
      const state = setup(data); const { view } = state;
      try {
        const values = view.host.querySelector('[data-connection-line]').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
        const index = axis === 'vertical' ? 1 : 0;
        const start = values[index], end = values[6 + index];
        assert.equal(Math.abs(end - start), 24, 'fixture has a short, positive gap between facing edges');
        for (const control of [values[2 + index], values[4 + index]]) {
          assert.ok(control >= Math.min(start, end) && control <= Math.max(start, end),
            `control point ${control} must remain between ${start} and ${end}`);
        }
        assert.notEqual(values[2 + (1 - index)], values[1 - index], 'relation keeps its perpendicular bow');
      } finally { state.close(); }
    });
  }
}

test('IME blocks drag and connection operations and preserves the preedit text', () => {
  const state = setup(branch()); const { view } = state;
  try {
    const element = input(view, '中心主题');
    element.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    input(view, 'zhong', { isComposing: true });
    const before = point(view, 'a');
    startDrag(view, 'a'); moveDrag(view, 250, 250); moveDrag(view, 250, 250, 'pointerup');
    assert.deepEqual(point(view, 'a'), before); assert.equal(context(view, 'a'), null);
    assert.equal(view.setLocked(true), false); assert.equal(element.value, 'zhong');
    assert.equal(element.readOnly, false); assert.equal(state.changes.length, 0);
    element.value = '中'; element.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    assert.equal(view.getData().nodes[0].text, '中'); view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
  } finally { state.close(); }
});

test('read-only connection selection cannot delete relations, and locking cancels connect mode', () => {
  const state = setup(branch()); const { view } = state;
  try {
    context(view, 'root'); menuAction(view, 'connect').click(); nodeButton(view, 'b').click();
    const saved = view.getData(); saved.connections[0].from = 'a';
    assert.equal(view.getData().connections[0].from, 'root', 'connection snapshots are independent');
    view.setEditable(false);
    const hit = view.host.querySelector('[data-connection-id]');
    hit.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.equal(menuAction(view, 'delete-connection').disabled, true);
    menuAction(view, 'delete-connection').click();
    view.host.querySelector('.mindmap-canvas').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    assert.equal(view.getData().connections.length, 1);
    view.setEditable(true); context(view, 'a'); menuAction(view, 'connect').click();
    view.setLocked(true); view.setLocked(false); nodeButton(view, 'b').click();
    assert.equal(view.getData().connections.length, 1);
    assert.equal(view.host.classList.contains('mindmap-connecting'), false);
  } finally { state.close(); }
});

test('add child and sibling, confirm subtree deletion, and undo the deletion', () => {
  const state = setup(); const { view } = state;
  try {
    button(view, '子主题').click();
    const first = view.getData().nodes.at(-1);
    assert.equal(first.parent, 'root');
    button(view, '同级主题').click();
    const second = view.getData().nodes.at(-1);
    assert.equal(second.parent, 'root');
    button(view, '子主题').click();
    view.host.querySelector(`[data-node-id="${second.id}"]`).click();
    button(view, '删除').click();
    assert.equal(view.getData().nodes.length, 4, 'deletion waits for inline confirmation');
    button(view, '确认删除').click();
    assert.equal(view.getData().nodes.length, 2);
    view.undo();
    assert.equal(view.getData().nodes.length, 4);
    view.redo();
    assert.equal(view.getData().nodes.length, 2);
    view.host.querySelector('[data-node-id="root"]').click();
    assert.equal(button(view, '删除').disabled, true);
    assert.equal(state.changes.length, 6);
  } finally { state.close(); }
});

test('Chinese composition is one undo step and user text is rendered as text', () => {
  const state = setup(); const { view } = state;
  try {
    const element = view.host.querySelector('[aria-label="节点文字"]');
    element.focus();
    element.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    input(view, 'zhong', { isComposing: true });
    assert.equal(view.getData().nodes[0].text, '中心主题');
    view.undo();
    assert.equal(element.value, 'zhong', 'undo during IME must leave preedit alone');
    element.value = '中文';
    element.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    assert.equal(view.getData().nodes[0].text, '中文');
    view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
    view.redo();
    assert.equal(view.getData().nodes[0].text, '中文');
    input(view, '<img src=x onerror=alert(1)>');
    assert.equal(view.host.querySelectorAll('img').length, 0);
    assert.match(view.host.querySelector('[data-node-id="root"]').textContent, /<img/);
    view.undo();
    assert.equal(view.getData().nodes[0].text, '中文');
  } finally { state.close(); }
});

test('links can be opened and removed, and renames survive undo and redo', async () => {
  const opened = [];
  const state = setup(base(), { platform: 'win32', onLink: async () => 'C:\\notes\\first.md', onOpen: async id => opened.push(id) });
  const { view } = state;
  try {
    button(view, '关联 Markdown').click(); await tick();
    assert.equal(view.getData().nodes[0].file, 'C:\\notes\\first.md');
    assert.equal(view.host.querySelector('.mindmap-file').textContent, '★');
    assert.equal(view.host.querySelector('.mindmap-file').getAttribute('aria-label'), '打开关联文件：first.md');
    button(view, '打开文件').click(); await tick();
    assert.deepEqual(opened, ['root']);
    input(view, '修改文字');
    view.replaceFile('c:/NOTES/first.md', 'C:\\notes\\renamed.md');
    view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
    assert.equal(view.getData().nodes[0].file, 'C:\\notes\\renamed.md');
    view.redo();
    assert.equal(view.getData().nodes[0].file, 'C:\\notes\\renamed.md');
    button(view, '取消关联').click();
    assert.equal(view.getData().nodes[0].file, null);
    assert.equal(view.host.querySelector('.mindmap-file'), null);
    assert.equal(view.host.querySelector('.mindmap-selection-detail').hidden, true);
    assert.doesNotMatch(view.host.textContent, /未关联/);
    view.undo();
    assert.equal(view.getData().nodes[0].file, 'C:\\notes\\renamed.md');
    assert.equal(JSON.parse(view.getText()).nodes[0].file, 'C:\\notes\\renamed.md');
  } finally { state.close(); }
});

const caseSensitiveLinks = () => {
  const data = branch();
  data.nodes[0].file = '/notes/Plan.md';
  data.nodes[1].file = '/notes/plan.md';
  return data;
};
const linkedPaths = view => view.getData().nodes.slice(0, 2).map(node => node.file);

test('Mac rename applies only filesystem-verified aliases to the current links', () => {
  const data = caseSensitiveLinks(); data.nodes[2].file = '/notes/PLAN.md';
  const state = setup(data, { platform: 'darwin' });
  try {
    state.view.replaceFile('/notes/Plan.md', '/notes/Renamed.md', ['/notes/plan.md']);
    assert.deepEqual(state.view.getData().nodes.map(node => node.file), ['/notes/Renamed.md', '/notes/Renamed.md', '/notes/PLAN.md']);
  } finally { state.close(); }
});

test('rename gathers unique links from current data plus undo and redo snapshots without changing history', () => {
  const state = setup(caseSensitiveLinks(), { platform: 'darwin' });
  const { view } = state;
  try {
    button(view, '取消关联').click();
    assert.equal(view.attachFile('root', '/notes/other.md'), true);
    nodeButton(view, 'a').click();
    button(view, '取消关联').click();
    assert.equal(view.attachFile('a', '/notes/future.md'), true);
    view.undo();
    const before = view.getText(), changes = state.changes.length;
    assert.equal(typeof view.getLinkedFilePaths, 'function');
    assert.deepEqual(view.getLinkedFilePaths().sort(), ['/notes/Plan.md', '/notes/future.md', '/notes/other.md', '/notes/plan.md']);
    assert.equal(view.getText(), before); assert.equal(state.changes.length, changes);
    assert.equal(view.redo(), true);
    assert.deepEqual(linkedPaths(view), ['/notes/other.md', '/notes/future.md']);
  } finally { state.close(); }
});

for (const history of ['undo', 'redo']) {
  test(`Mac rename updates a verified alias present only in ${history} history`, () => {
    const data = base(); data.nodes[0].file = history === 'undo' ? '/notes/plan.md' : null;
    const state = setup(data, { platform: 'darwin' });
    const { view } = state;
    try {
      if (history === 'undo') button(view, '取消关联').click();
      else { assert.equal(view.attachFile('root', '/notes/plan.md'), true); assert.equal(view.undo(), true); }
      const before = view.getText(), changes = state.changes.length;
      view.replaceFile('/notes/Plan.md', '/notes/Renamed.md', ['/notes/plan.md']);
      assert.equal(view.getText(), before); assert.equal(state.changes.length, changes);
      assert.equal(view[history](), true);
      assert.equal(view.getData().nodes[0].file, '/notes/Renamed.md');
    } finally { state.close(); }
  });
}

test('Mac selection hint uses Command while Windows retains Control', () => {
  const mac = setup(base(), { platform: 'darwin' }), windows = setup(base(), { platform: 'win32' });
  try {
    assert.match(mac.view.host.querySelector('.mindmap-hint').textContent, /⌘ \/ Shift/);
    assert.match(windows.view.host.querySelector('.mindmap-hint').textContent, /Ctrl \/ Shift/);
  } finally { mac.close(); windows.close(); }
});

test('Mac rename updates only the matching case-sensitive link across open maps', () => {
  const matching = setup(caseSensitiveLinks(), { platform: 'darwin' });
  const unrelatedData = base(); unrelatedData.nodes[0].file = '/notes/plan.md';
  const unrelated = setup(unrelatedData, { platform: 'darwin' });
  try {
    for (const { view } of [matching, unrelated]) view.replaceFile('/notes/Plan.md', '/notes/Renamed.md');
    assert.deepEqual(linkedPaths(matching.view), ['/notes/Renamed.md', '/notes/plan.md']);
    assert.equal(unrelated.view.getData().nodes[0].file, '/notes/plan.md');
    assert.equal(unrelated.changes.length, 0, 'broadcasting another file rename must not dirty an unrelated map');
  } finally { matching.close(); unrelated.close(); }
});

test('Mac rename preserves case-distinct links throughout existing undo and redo history', () => {
  const state = setup(caseSensitiveLinks(), { platform: 'darwin' });
  const { view } = state;
  try {
    input(view, 'first edit').blur();
    input(view, 'second edit').blur();
    assert.equal(view.undo(), true);
    view.replaceFile('/notes/Plan.md', '/notes/Renamed.md');
    assert.equal(view.undo(), true);
    assert.equal(view.getData().nodes[0].text, '中心主题');
    assert.deepEqual(linkedPaths(view), ['/notes/Renamed.md', '/notes/plan.md']);
    assert.equal(view.redo(), true);
    assert.equal(view.getData().nodes[0].text, 'first edit');
    assert.deepEqual(linkedPaths(view), ['/notes/Renamed.md', '/notes/plan.md']);
    assert.equal(view.redo(), true);
    assert.equal(view.getData().nodes[0].text, 'second edit');
    assert.deepEqual(linkedPaths(view), ['/notes/Renamed.md', '/notes/plan.md']);
    assert.deepEqual(state.errors, []);
  } finally { state.close(); }
});

test('Mac rename preserves case-distinct links in a pending text edit snapshot', () => {
  const state = setup(caseSensitiveLinks(), { platform: 'darwin' });
  const { view } = state;
  try {
    input(view, 'pending edit');
    view.replaceFile('/notes/Plan.md', '/notes/Renamed.md');
    assert.equal(view.undo(), true);
    assert.equal(view.getData().nodes[0].text, '中心主题');
    assert.deepEqual(linkedPaths(view), ['/notes/Renamed.md', '/notes/plan.md']);
    assert.equal(view.redo(), true);
    assert.equal(view.getData().nodes[0].text, 'pending edit');
    assert.deepEqual(linkedPaths(view), ['/notes/Renamed.md', '/notes/plan.md']);
  } finally { state.close(); }
});

test('save preserves edit history, current selection and independent viewport state', () => {
  const first = setup(), second = setup();
  try {
    button(first.view, '子主题').click();
    input(first.view, '已保存的主题');
    first.view.setZoom(140);
    const canvas = first.view.host.querySelector('.mindmap-canvas');
    canvas.scrollLeft = 180; canvas.scrollTop = 220;
    first.view.capturePosition();
    first.view.setSaved(first.view.getData());
    assert.equal(first.view.host.querySelector('[aria-label="节点文字"]').value, '已保存的主题');
    first.view.undo();
    assert.equal(first.view.getData().nodes.at(-1).text, '新主题');
    first.view.host.remove(); canvas.scrollLeft = 0; canvas.scrollTop = 0;
    document.body.append(first.view.host); first.view.restorePosition();
    assert.equal(canvas.scrollLeft, 180); assert.equal(canvas.scrollTop, 220);
    assert.equal(first.view.getZoom(), 140); assert.equal(second.view.getZoom(), 100);
  } finally { first.close(); second.close(); }
});

test('read-only views reject content changes while linked files can still open', async () => {
  const data = base(); data.nodes[0].file = 'C:\\notes\\root.md';
  const opened = [];
  const state = setup(data, { onOpen: async id => opened.push(id) }); const { view } = state;
  try {
    view.setEditable(false);
    button(view, '子主题').click(); input(view, '不应写入'); view.undo();
    view.host.querySelector('.mindmap-canvas').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert.equal(view.getData().nodes.length, 1);
    assert.equal(view.getData().nodes[0].text, '中心主题');
    button(view, '打开文件').click(); await tick();
    assert.deepEqual(opened, ['root']); assert.equal(state.changes.length, 0);
  } finally { state.close(); }
});

test('collapse hides descendants and undo restores their visible nodes', () => {
  const state = setup(); const { view } = state;
  try {
    button(view, '子主题').click();
    button(view, '子主题').click();
    view.host.querySelector('[data-node-id="root"]').click();
    button(view, '折叠').click();
    assert.equal(view.host.querySelectorAll('[data-node-id]').length, 1);
    assert.equal(view.getData().nodes.length, 3);
    view.undo();
    assert.equal(view.host.querySelectorAll('[data-node-id]').length, 3);
  } finally { state.close(); }
});

test('pending association retains its initiating node while the app locks editing', async () => {
  let resolve;
  const state = setup(base(), { onLink: () => new Promise(done => { resolve = done; }) }); const { view } = state;
  try {
    button(view, '关联 Markdown').click(); view.setEditable(false);
    resolve('C:\\notes\\chosen.md'); await tick();
    assert.equal(view.getData().nodes[0].file, 'C:\\notes\\chosen.md');
    view.setEditable(true); view.undo();
    assert.equal(view.getData().nodes[0].file, null);
  } finally { state.close(); }
});

test('saving after zoom preserves node positions and the visible viewport', () => {
  const state = setup(); const { view } = state;
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1000 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    view.setSaved(view.getData());
    const before = view.host.querySelector('.mindmap-root').style.cssText;
    view.setZoom(150);
    canvas.scrollLeft = 260; canvas.scrollTop = 160;
    view.setSaved(view.getData());
    assert.equal(view.host.querySelector('.mindmap-root').style.cssText, before);
    assert.equal(canvas.scrollLeft, 260); assert.equal(canvas.scrollTop, 160);
  } finally { state.close(); }
});

test('a node limit error keeps the document intact and leaves history usable', () => {
  const data = base();
  for (let index = 1; index < 1000; index++) data.nodes.push({ id: `n${index}`, parent: 'root', text: '主题', file: null, collapsed: false });
  data.nodes[0].collapsed = true;
  const state = setup(data); const { view } = state;
  try {
    input(view, '原有主题');
    button(view, '子主题').click();
    assert.equal(view.getData().nodes.length, 1000);
    assert.equal(view.getData().nodes[0].collapsed, true, 'failed additions must not expand branches');
    assert.equal(state.errors.length, 1);
    view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
  } finally { state.close(); }
});

test('freezing during IME is refused without losing the candidate or its undo transaction', () => {
  const state = setup(); const { view } = state;
  try {
    const element = view.host.querySelector('[aria-label="节点文字"]');
    element.focus();
    element.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    input(view, 'zhongwen', { isComposing: true });
    assert.equal(view.setEditable(false), false, 'freeze must be deferred until composition ends');
    assert.equal(view.isComposing(), true);
    assert.equal(element.readOnly, false);
    assert.equal(element.value, 'zhongwen');
    element.value = '中文';
    element.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    assert.equal(view.isComposing(), false);
    assert.equal(view.getData().nodes[0].text, '中文');
    assert.equal(state.changes.length, 1);
    view.undo();
    assert.equal(view.getData().nodes[0].text, '中心主题');
    assert.equal(view.setEditable(false), true);
    assert.equal(element.readOnly, true);
  } finally { state.close(); }
});
