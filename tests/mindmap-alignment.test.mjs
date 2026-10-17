import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMindmapView } from '../src/mindmap-view.js';
import { setLocale } from '../src/i18n.mjs';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const n = (id, parent, offset) => ({ id, parent, text: id, file: null, collapsed: false, ...(offset ? { offset } : {}) });
const fixture = () => ({ format: 'md-mindmap', version: 2, root: 'root', connections: [], nodes: [n('root', null), n('a', 'root', { x: 80, y: 10 }), n('child', 'a'), n('b', 'root', { x: -20, y: 30 }), n('c', 'root')] });
const node = (v, id) => v.host.querySelector(`[data-node-id="${id}"]`);
const canvas = v => v.host.querySelector('.mindmap-canvas');
const click = (v, id, modifiers = {}) => node(v, id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...modifiers }));
const points = v => Object.fromEntries([...v.host.querySelectorAll('[data-node-card]')].map(el => [el.dataset.nodeCard, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) }]));
const selected = v => [...v.host.querySelectorAll('.mindmap-selected')].map(el => el.dataset.nodeCard).sort();
const guides = v => [...v.host.querySelectorAll('.mindmap-guides [data-guide-axis]')];
function pointer(target, type, x, y, modifiers = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...modifiers });
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
}
const start = (v, id = 'a') => pointer(node(v, id), 'pointerdown', 200, 200);
const move = (v, dx, dy, modifiers) => pointer(canvas(v), 'pointermove', 200 + dx, 200 + dy, modifiers);
const up = v => pointer(canvas(v), 'pointerup', 200, 200);
const key = (name, type = 'keydown') => document.dispatchEvent(new dom.window.KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }));
function setup(data = fixture()) {
  const errors = []; let changes = 0;
  const view = createMindmapView(data, { onError: e => errors.push(e), onChange: () => changes++ }); document.body.append(view.host);
  return { view, errors, changes: () => changes, close() { view.destroy(); setLocale('zh-CN'); } };
}

test('modifier clicks prepare a movable group without fixed alignment actions', () => {
  const f = setup(), v = f.view;
  try {
    click(v, 'a'); click(v, 'b', { ctrlKey: true }); click(v, 'c', { shiftKey: true }); assert.deepEqual(selected(v), ['a', 'b', 'c']);
    assert.equal([...v.host.querySelectorAll('button')].some(el => /横向对齐|纵向对齐/.test(el.textContent)), false);
    click(v, 'b', { metaKey: true }); assert.deepEqual(selected(v), ['a', 'c']); click(v, 'a'); assert.deepEqual(selected(v), ['a']);
    assert.equal(f.changes(), 0); assert.deepEqual(v.getData(), fixture());
  } finally { f.close(); }
});
test('nearby dragging previews a guide and exact alignment, then saves one undoable move', () => {
  const f = setup(), v = f.view;
  try {
    const before = points(v), original = v.getText(); start(v); move(v, 35, before.b.y - before.a.y - 3);
    const preview = points(v); assert.equal(preview.a.y, before.b.y); assert.ok(guides(v).some(line => line.dataset.guideAxis === 'y'));
    assert.equal(preview.child.y - before.child.y, preview.a.y - before.a.y); assert.equal(v.getText(), original);
    up(v); assert.equal(guides(v).length, 0); assert.deepEqual(points(v), preview); assert.equal(f.changes(), 1);
    assert.equal(v.undo(), true); assert.deepEqual(v.getText(), original); assert.equal(v.redo(), true); assert.deepEqual(points(v), preview);
    const reopened = setup(JSON.parse(v.getText())); try { assert.deepEqual(points(reopened.view), preview); } finally { reopened.close(); }
  } finally { f.close(); }
});
test('moving away releases snapping; Alt changes the current drag immediately and Escape cancels', () => {
  const f = setup(), v = f.view;
  try {
    const before = points(v), dy = before.b.y - before.a.y - 3; start(v); move(v, 35, dy); assert.equal(points(v).a.y, before.b.y);
    key('Alt'); assert.equal(points(v).a.y, before.a.y + dy); assert.equal(guides(v).length, 0);
    key('Alt', 'keyup'); assert.equal(points(v).a.y, before.b.y); assert.ok(guides(v).length);
    move(v, 35, dy - 20); assert.equal(points(v).a.y, before.a.y + dy - 20); assert.equal(guides(v).length, 0);
    move(v, 35, dy); key('Escape'); assert.deepEqual(points(v), before); assert.equal(guides(v).length, 0); assert.equal(f.changes(), 0);
  } finally { f.close(); }
});
test('snapping uses screen pixels at 150 percent and language switching preserves the gesture', () => {
  const f = setup(), v = f.view;
  try {
    v.setZoom(150); const before = points(v); start(v); move(v, 52.5, (before.b.y - before.a.y) * 1.5 - 5);
    assert.equal(points(v).a.y, before.b.y); assert.ok(guides(v).length); setLocale('en'); assert.match(v.host.querySelector('.mindmap-hint').textContent, /Alt/);
    move(v, 52.5, (before.b.y - before.a.y) * 1.5 - 8); assert.ok(Math.abs(points(v).a.y - (before.b.y - 8 / 1.5)) < .001); assert.equal(guides(v).length, 0);
    key('Escape'); assert.deepEqual(points(v), before);
  } finally { f.close(); }
});
test('selected parent and child move once and never use moving nodes as snap targets', () => {
  const f = setup(), v = f.view;
  try {
    click(v, 'a'); click(v, 'child', { ctrlKey: true }); click(v, 'b', { shiftKey: true }); const before = points(v); start(v, 'child'); move(v, 50, 3);
    const preview = points(v); for (const id of ['a', 'child', 'b']) assert.deepEqual(preview[id], { x: before[id].x + 50, y: before[id].y + 3 });
    assert.equal(guides(v).length, 0); assert.deepEqual(preview.c, before.c); up(v); v.undo(); assert.deepEqual(points(v), before); v.redo(); assert.deepEqual(points(v), preview);
  } finally { f.close(); }
});
test('reading, locking and canceled gestures clear guides without changing the document', () => {
  const f = setup(), v = f.view;
  try {
    const before = points(v), original = v.getText();
    for (const cancel of [() => v.setEditable(false), () => v.setLocked(true), () => pointer(canvas(v), 'pointercancel', 0, 0)]) {
      v.setEditable(true); v.setLocked(false); start(v); move(v, 35, before.b.y - before.a.y - 3); assert.ok(guides(v).length);
      cancel(); assert.equal(guides(v).length, 0); assert.deepEqual(points(v), before);
    }
    v.setEditable(false); start(v); move(v, 35, 137); up(v); assert.equal(v.getText(), original); assert.equal(f.changes(), 0); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
test('right-click keeps the group and ignores queued scrolls without movement', () => {
  const f = setup(), v = f.view;
  try {
    click(v, 'a'); click(v, 'b', { ctrlKey: true }); node(v, 'a').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.deepEqual(selected(v), ['a', 'b']); assert.equal(v.host.querySelector('[data-action^="align-"]'), null);
    const menu = v.host.querySelector('[role="menu"]'); canvas(v).dispatchEvent(new dom.window.Event('scroll')); assert.equal(v.host.querySelector('[role="menu"]'), menu);
    canvas(v).scrollLeft += 20; canvas(v).dispatchEvent(new dom.window.Event('scroll')); assert.equal(v.host.querySelector('[role="menu"]'), null);
  } finally { f.close(); }
});

test('loaded negative offsets keep stationary nodes and guides fixed through dragging and undo', () => {
  const data = fixture(); data.nodes.find(item => item.id === 'a').offset = { x: -800, y: -500 };
  const f = setup(data), v = f.view;
  try {
    const before = points(v); start(v); move(v, 50, 30, { altKey: true });
    assert.deepEqual(points(v).a, { x: before.a.x + 50, y: before.a.y + 30 });
    assert.deepEqual(points(v).root, before.root); assert.deepEqual(points(v).b, before.b);
    move(v, before.root.x - before.a.x - 3, 30);
    const aligned = points(v); assert.equal(aligned.a.x, before.root.x);
    assert.deepEqual(aligned.root, before.root); assert.deepEqual(aligned.b, before.b);
    const line = guides(v).find(item => item.dataset.guideAxis === 'x');
    assert.equal(Number(line.getAttribute('x1')), aligned.a.x + 108);
    up(v); assert.deepEqual(points(v), aligned); v.undo(); assert.deepEqual(points(v), before);
    v.redo(); assert.deepEqual(points(v), aligned); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
