import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://moye.local' });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { createMindmapView } = await import('../src/mindmap-view.js');
const { setLocale } = await import('../src/i18n.mjs');
const data = () => ({ format: 'md-mindmap', version: 2, root: 'root', nodes: [
  { id: 'root', parent: null, text: '中心', file: null, collapsed: false },
  { id: 'a', parent: 'root', text: '子节点', file: null, collapsed: false },
], connections: [{ id: 'edge', from: 'root', to: 'a' }] });
function setup(options = {}, initial = data()) {
  const changes = [], errors = []; const view = createMindmapView(initial, { onChange: () => changes.push(view.getData()), onError: message => errors.push(message), ...options });
  document.body.append(view.host);
  return { view, changes, errors, close() { view.destroy(); setLocale('zh-CN'); } };
}
const node = (view, id = 'a') => view.host.querySelector(`[data-node-id="${id}"]`);
const canvas = view => view.host.querySelector('.mindmap-canvas');
const hit = view => view.host.querySelector('[data-connection-id="edge"]');
const labelInput = view => view.host.querySelector('.mindmap-connection-input');
const button = (view, text) => [...view.host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === text);
const dbl = el => el.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const write = (el, value, composing = false) => { el.value = value; el.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: composing })); };
const pointer = (target, type, x, y) => { const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event); };

function measuredLabels(run) {
  const prototype = dom.window.HTMLElement.prototype;
  const width = Object.getOwnPropertyDescriptor(prototype, 'offsetWidth'), height = Object.getOwnPropertyDescriptor(prototype, 'offsetHeight');
  Object.defineProperty(prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('mindmap-connection-label') ? 200 : width.get.call(this); } });
  Object.defineProperty(prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('mindmap-connection-label') ? 32 : height.get.call(this); } });
  try { run(); } finally { Object.defineProperty(prototype, 'offsetWidth', width); Object.defineProperty(prototype, 'offsetHeight', height); }
}
function assertLabelsUnobstructed(view) {
  const boxes = [...view.host.querySelectorAll('[data-node-card]')].map(card => ({ name: card.dataset.nodeCard, x: parseFloat(card.style.left), y: parseFloat(card.style.top), width: 216, height: 96 }));
  for (const label of view.host.querySelectorAll('[data-connection-label]')) {
    const box = { name: label.dataset.connectionLabel, x: parseFloat(label.style.left) - 100, y: parseFloat(label.style.top) - 16, width: 200, height: 32 };
    assert.ok(box.x >= 0 && box.y >= 0, 'labels remain reachable within the stage');
    for (const other of boxes) assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y, `${box.name} must not overlap ${other.name}`);
    boxes.push(box);
  }
}

test('connection labels avoid close nodes before, during and after dragging and keep their editing actions', () => measuredLabels(() => {
  const initial = data(); initial.version = 4; initial.nodes.push({ id: 'b', parent: 'root', text: '邻近节点', file: null, collapsed: false });
  initial.connections = [{ id: 'edge', from: 'a', to: 'b', label: '参考资料 → 实施依据' }];
  const f = setup({}, initial), { view } = f;
  try {
    assertLabelsUnobstructed(view);
    pointer(node(view), 'pointerdown', 200, 200); pointer(canvas(view), 'pointermove', 275, 225); assertLabelsUnobstructed(view);
    pointer(canvas(view), 'pointerup', 275, 225); assertLabelsUnobstructed(view);
    assert.ok(view.host.querySelector('[data-connection-leader="edge"]'), 'displaced label retains a visual link to its connection');
    view.setZoom(150); assertLabelsUnobstructed(view);
    const label = view.host.querySelector('[data-connection-label="edge"]');
    label.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    view.host.querySelector('[data-action="edit-connection"]').click(); assert.equal(document.activeElement, labelInput(view));
    canvas(view).focus(); dbl(label); assert.equal(document.activeElement, labelInput(view));
    assert.equal(view.getData().connections[0].label, initial.connections[0].label);
  } finally { f.close(); }
}));

test('long connection labels avoid overlapping nodes and each other without changing saved layout', () => measuredLabels(() => {
  const initial = data(); initial.version = 4;
  initial.nodes.push({ id: 'b', parent: 'root', text: 'B', file: null, collapsed: false }, { id: 'c', parent: 'root', text: 'C', file: null, collapsed: false });
  initial.nodes[1].offset = { x: -292, y: 120 }; initial.nodes[2].offset = { x: -292, y: 0 }; initial.nodes[3].offset = { x: -292, y: -120 };
  initial.connections = [['a', 'b'], ['b', 'c'], ['a', 'c']].map(([from, to], index) => ({ id: `edge${index}`, from, to, label: '长说明'.repeat(60) }));
  const f = setup({}, initial), { view } = f;
  try {
    assertLabelsUnobstructed(view); assert.equal(view.host.querySelectorAll('[data-connection-label]').length, 3);
    assert.equal(view.host.querySelectorAll('[data-connection-leader]').length, 3);
    assert.deepEqual(view.getData(), initial); assert.equal(view.undo(), false);
    view.setEditable(false); assertLabelsUnobstructed(view); view.setZoom(200); assertLabelsUnobstructed(view);
  } finally { f.close(); }
}));

test('connection labels are directly editable, saved as v4, cleared and restored by undo', () => {
  const f = setup(), { view } = f;
  try {
    const line = hit(view); line.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(hit(view), line, 'selecting the line must preserve its DOM for a following double-click');
    const input = labelInput(view); assert.ok(input); assert.equal(input.maxLength, 200); assert.equal(input.closest('.mindmap-connection-editor').hidden, false);
    dbl(line); assert.equal(document.activeElement, input);
    write(input, '关系 <说明>'); input.blur();
    assert.equal(view.getData().version, 4); assert.equal(view.getData().connections[0].label, '关系 <说明>');
    const chip = view.host.querySelector('[data-connection-label="edge"]'); assert.equal(chip.textContent, '关系 <说明>'); assert.equal(chip.querySelector('说明'), null);
    assert.equal(JSON.parse(view.getText()).connections[0].label, '关系 <说明>');
    view.setSaved(JSON.parse(view.getText())); button(view, '清空说明').click();
    assert.equal(view.getData().connections[0].label, undefined); assert.equal(view.getData().version, 4); assert.equal(view.host.querySelector('[data-connection-label]'), null);
    assert.equal(view.undo(), true); assert.equal(view.getData().connections[0].label, '关系 <说明>');
    assert.equal(view.undo(), true); assert.equal(view.getData().connections[0].label, undefined);
    assert.equal(view.redo(), true); assert.equal(view.getData().connections[0].label, '关系 <说明>');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('connection label IME, language, read mode and lock preserve input and permissions', () => {
  const f = setup(), { view } = f;
  try {
    dbl(hit(view)); const input = labelInput(view); assert.ok(input);
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })); write(input, '正在组合', true); input.setSelectionRange(1, 3);
    setLocale('en'); assert.equal(input.value, '正在组合'); assert.equal(input.selectionStart, 1); assert.equal(view.isComposing(), true);
    assert.equal(view.setLocked(true), false); assert.equal(view.getData().connections[0].label, undefined);
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true })); assert.equal(view.getData().connections[0].label, '正在组合');
    assert.equal(view.undo(), true); assert.equal(view.getData().connections[0].label, undefined); view.redo();
    const before = view.getText(); view.setEditable(false); assert.equal(input.readOnly, true); write(input, '不允许'); assert.equal(view.getText(), before);
    view.setEditable(true); view.setLocked(true); write(input, '仍不允许'); assert.equal(view.getText(), before); view.setLocked(false);
    write(input, 'x'.repeat(201)); assert.equal(view.getText(), before); write(input, '非法\u0001文字'); assert.equal(view.getText(), before); assert.equal(f.errors.length, 2);
    input.value = view.getData().connections[0].label;
    view.setEditable(false); assert.equal(view.host.querySelector('[data-connection-label]').textContent, '正在组合');
  } finally { f.close(); }
});

test('connection labels follow node motion and scale with the existing world', () => {
  const f = setup(), { view } = f;
  try {
    dbl(hit(view)); write(labelInput(view), '连接'); labelInput(view).blur();
    const pos = () => { const chip = view.host.querySelector('[data-connection-label]'); return { left: parseFloat(chip.style.left), top: parseFloat(chip.style.top) }; };
    const before = pos(); pointer(node(view), 'pointerdown', 200, 200); pointer(canvas(view), 'pointermove', 260, 240); pointer(canvas(view), 'pointerup', 260, 240);
    const after = pos(); assert.ok(after.left > before.left); assert.ok(after.top > before.top);
    view.setZoom(150); assert.equal(view.host.querySelector('.mindmap-world').style.transform, 'scale(1.5)'); assert.deepEqual(pos(), after);
    view.host.querySelector('[data-connection-label]').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const menuItem = view.host.querySelector('[data-action="edit-connection"]'); assert.ok(menuItem); menuItem.click(); assert.equal(document.activeElement, labelInput(view));
  } finally { f.close(); }
});

test('adding a node from a connection selection opens node editing and undo restores the connection inspector', () => {
  const f = setup(), { view } = f;
  try {
    dbl(hit(view)); write(labelInput(view), '原连接'); labelInput(view).blur();
    button(view, '子主题').click();
    const added = view.getData().nodes.at(-1), text = view.host.querySelector('.mindmap-text-input');
    assert.equal(view.host.querySelector('.mindmap-editor-row').hidden, false);
    assert.equal(view.host.querySelector('.mindmap-connection-editor').hidden, true);
    assert.equal(document.activeElement, text); assert.equal(text.value, added.text);
    assert.equal(view.undo(), true); assert.equal(view.getData().nodes.length, 2);
    assert.equal(view.host.querySelector('.mindmap-connection-editor').hidden, false);
    assert.equal(labelInput(view).value, '原连接');
  } finally { f.close(); }
});

test('unlinked node creation works in reading mode, is deduplicated and can be undone without recreating', async () => {
  let resolve; const created = [], opened = [];
  const f = setup({ onCreate: id => { created.push(id); return new Promise(done => { resolve = done; }); }, onOpen: (id, options) => opened.push({ id, options }) }), { view } = f;
  try {
    view.setEditable(false); dbl(node(view)); dbl(node(view)); assert.deepEqual(created, ['a']);
    resolve('C:/notes/新建.md'); await tick(); assert.equal(view.getData().nodes[1].file, 'C:/notes/新建.md'); assert.deepEqual(opened, [{ id: 'a', options: { created: true } }]);
    assert.equal(view.getData().nodes[1].text, '子节点'); view.setEditable(true); assert.equal(view.undo(), true); assert.equal(view.getData().nodes[1].file, null);
    assert.equal(view.redo(), true); assert.equal(created.length, 1);
    dbl(node(view)); await tick(); assert.equal(opened.length, 2); assert.equal(opened[1].options, undefined);
  } finally { f.close(); }
});

test('canceled, failed, stale and protected new-file actions do not change the map', async () => {
  let result = null, calls = 0; const f = setup({ onCreate: async () => { calls++; if (result instanceof Error) throw result; return result; } }), { view } = f;
  try {
    const before = view.getText(); dbl(node(view)); await tick(); assert.equal(view.getText(), before); assert.equal(view.undo(), false);
    result = new Error('cancel failed'); dbl(node(view)); await tick(); assert.equal(view.getText(), before); assert.deepEqual(f.errors, ['cancel failed']);
    view.setLocked(true); dbl(node(view)); assert.equal(calls, 2); view.setLocked(false);
    const text = view.host.querySelector('.mindmap-text-input'); text.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })); dbl(node(view)); assert.equal(calls, 2); text.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    node(view).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); assert.ok(view.host.querySelector('[data-action="create-markdown"]'));
    view.host.querySelector('[data-action="edit"]').click(); assert.equal(document.activeElement, text);
    canvas(view).focus(); canvas(view).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F2', bubbles: true })); assert.equal(document.activeElement, text);
  } finally { f.close(); }
  let finish; const stale = setup({ onCreate: () => new Promise(resolve => { finish = resolve; }) });
  dbl(node(stale.view)); const snapshot = stale.view.getText(); stale.close(); finish('C:/orphan.md'); await tick(); assert.equal(stale.view.getText(), snapshot);
});

test('palette and whole-map style retain independent undo and English labels', () => {
  const f = setup(), { view } = f;
  try {
    node(view).click(); const swatch = view.host.querySelector('[data-palette=blue]'), style = view.host.querySelector('[aria-label="整图风格"]');
    swatch.click(); const painted = view.getData(); style.value = 'capsule'; style.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(view.getData().theme, 'capsule'); assert.equal(view.getData().version, 5);
    view.undo(); assert.deepEqual(view.getData(), painted); view.redo();
    const before = view.getText(); view.setEditable(false); assert.equal(swatch.disabled, true); assert.equal(style.disabled, true);
    style.value = 'vine'; style.dispatchEvent(new dom.window.Event('change', { bubbles: true })); assert.equal(view.getText(), before);
    view.setEditable(true); view.refreshTheme(); assert.equal(view.host.dataset.mapTheme, 'capsule');
    setLocale('en'); assert.equal(style.getAttribute('aria-label'), 'Map style'); assert.equal(style.value, 'capsule');
    assert.equal(swatch.getAttribute('aria-label'), 'Palette: Blue'); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
