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
const viewportPoints = v => Object.fromEntries(Object.entries(points(v)).map(([id, point]) => [id, {
  x: point.x * v.getZoom() / 100 - canvas(v).scrollLeft,
  y: point.y * v.getZoom() / 100 - canvas(v).scrollTop,
}]));
const selected = v => [...v.host.querySelectorAll('.mindmap-selected')].map(el => el.dataset.nodeCard).sort();
const guides = v => [...v.host.querySelectorAll('.mindmap-guides [data-guide-axis]')];
function pointer(target, type, x, y, modifiers = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...modifiers });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } }); target.dispatchEvent(event);
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

test('a large root keeps following the pointer after its first child reaches the canvas boundary', () => {
  const data = { format: 'md-mindmap', version: 2, root: 'root', connections: [], nodes: [
    { ...n('root', null, { x: -800, y: -500 }), text: 'Course overview\nThree days\nSix units\nFinal project' },
    ...Array.from({ length: 6 }, (_, i) => n(`unit-${i}`, 'root')),
  ] };
  const f = setup(data), v = f.view;
  try {
    const before = viewportPoints(v), original = v.getText();
    assert.equal(points(v)['unit-0'].y, 24, 'the first child, rather than the root, touches the top edge');
    assert.ok(points(v).root.y > 200);
    start(v, 'root'); move(v, -70, -60);
    for (const [id, point] of Object.entries(before)) assert.deepEqual(viewportPoints(v)[id], { x: point.x - 70, y: point.y - 60 }, id);
    assert.equal(v.getText(), original, 'a preview does not mutate the document');
    up(v); assert.deepEqual(v.getData().nodes[0].offset, { x: -870, y: -560 });
    assert.equal(f.changes(), 1); const moved = viewportPoints(v);
    v.undo(); assert.deepEqual(viewportPoints(v), before); v.redo(); assert.deepEqual(viewportPoints(v), moved);
    const reopened = setup(JSON.parse(v.getText()));
    try { assert.deepEqual(reopened.view.getData(), v.getData()); } finally { reopened.close(); }
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('extending the canvas keeps stationary cards and snap guides fixed and Escape restores the viewport', () => {
  const data = fixture(); data.nodes.find(item => item.id === 'a').offset = { x: -800, y: -500 };
  const f = setup(data), v = f.view;
  try {
    v.setZoom(150);
    const before = viewportPoints(v), original = v.getText();
    start(v); move(v, -75, -60, { altKey: true });
    const preview = viewportPoints(v);
    for (const id of ['a', 'child']) assert.deepEqual(preview[id], { x: before[id].x - 75, y: before[id].y - 60 }, id);
    for (const id of ['root', 'b', 'c']) assert.deepEqual(preview[id], before[id], id);
    move(v, before.root.x - before.a.x - 3, 30);
    assert.equal(viewportPoints(v).a.x, before.root.x);
    assert.deepEqual(viewportPoints(v).root, before.root);
    const line = guides(v).find(item => item.dataset.guideAxis === 'x');
    assert.ok(line, 'alignment remains available after growing the canvas');
    assert.equal(Number(line.getAttribute('x1')), points(v).root.x + 108);
    key('Escape');
    assert.deepEqual(viewportPoints(v), before); assert.equal(v.getText(), original);
    assert.equal(guides(v).length, 0); assert.equal(f.changes(), 0); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('a selected group crosses the canvas edge together without moving a selected descendant twice', () => {
  const data = fixture(); data.nodes.find(item => item.id === 'a').offset = { x: -800, y: -500 };
  const f = setup(data), v = f.view;
  try {
    click(v, 'a'); click(v, 'child', { ctrlKey: true }); click(v, 'b', { shiftKey: true });
    const before = viewportPoints(v); start(v, 'child'); move(v, -50, -40, { altKey: true }); up(v);
    for (const id of ['a', 'child', 'b']) assert.deepEqual(viewportPoints(v)[id], { x: before[id].x - 50, y: before[id].y - 40 }, id);
    for (const id of ['root', 'c']) assert.deepEqual(viewportPoints(v)[id], before[id], id);
    assert.equal(v.getData().nodes.find(item => item.id === 'child').offset, undefined);
    assert.deepEqual(selected(v), ['a', 'b', 'child']); assert.equal(f.changes(), 1);
    v.undo(); assert.deepEqual(viewportPoints(v), before); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('a map smaller than the viewport has room to compensate scrolling during and after a boundary drag', () => {
  const data = { format: 'md-mindmap', version: 2, root: 'root', connections: [], nodes: [n('root', null, { x: -800, y: -500 })] };
  const f = setup(data), v = f.view;
  try {
    const viewport = canvas(v), stage = v.host.querySelector('.mindmap-stage');
    // jsdom has no layout or bounded scrolling. Model the browser's scroll
    // range here so an undersized stage cannot hide a viewport jump.
    for (const [axis, size, extent] of [['Left', 'Width', 1200], ['Top', 'Height', 1000]]) {
      let position = 0;
      Object.defineProperty(viewport, `client${size}`, { configurable: true, get: () => extent });
      Object.defineProperty(viewport, `scroll${axis}`, {
        configurable: true,
        get: () => position = Math.max(0, Math.min(position, parseFloat(stage.style[size.toLowerCase()]) - extent)),
        set: value => { position = Math.max(0, Math.min(value, parseFloat(stage.style[size.toLowerCase()]) - extent)); },
      });
    }
    v.restoreSessionState({ layoutPadding: v.captureSessionState().layoutPadding, position: { left: 0, top: 0 } });
    const before = viewportPoints(v);
    start(v, 'root'); move(v, -70, -60);
    const expected = { root: { x: before.root.x - 70, y: before.root.y - 60 } };
    assert.deepEqual(viewportPoints(v), expected, 'the preview must follow the pointer');
    up(v); assert.deepEqual(viewportPoints(v), expected, 'committing must not shrink away the needed scroll range');
    v.undo(); assert.deepEqual(viewportPoints(v), before); v.redo(); assert.deepEqual(viewportPoints(v), expected);
  } finally { f.close(); }
});

test('fractional display scaling does not accumulate scroll rounding across a boundary drag', () => {
  const data = fixture(); data.nodes.find(item => item.id === 'a').offset = { x: -800, y: -500 };
  const f = setup(data), v = f.view;
  try {
    const viewport = canvas(v);
    for (const axis of ['Left', 'Top']) {
      let position = 0;
      Object.defineProperty(viewport, `scroll${axis}`, {
        configurable: true, get: () => position,
        set: value => { position = Math.round(value * 1.25) / 1.25; },
      });
    }
    const before = viewportPoints(v); start(v);
    for (let step = 1; step <= 8; step++) move(v, -70 * step / 8, -60 * step / 8, { altKey: true });
    up(v);
    const moved = viewportPoints(v);
    for (const id of ['a', 'child']) {
      assert.ok(Math.abs(moved[id].x - before[id].x + 70) <= .41, `${id} horizontal rounding is at most half a device pixel`);
      assert.ok(Math.abs(moved[id].y - before[id].y + 60) <= .41, `${id} vertical rounding is at most half a device pixel`);
    }
  } finally { f.close(); }
});

test('mouse hover events cannot jump a node or pan the canvas during an active drag', () => {
  const f = setup(), v = f.view;
  try {
    const before = viewportPoints(v);
    start(v, 'root'); move(v, 40, 25);
    const preview = viewportPoints(v);
    move(v, 950, 600, { buttons: 0 });
    assert.deepEqual(viewportPoints(v), preview, 'unpressed mouse movement is not a drag update');
    move(v, 80, 50); up(v);
    assert.deepEqual(viewportPoints(v).root, { x: before.root.x + 80, y: before.root.y + 50 });
    assert.deepEqual(v.getData().nodes[0].offset, { x: 80, y: 50 });
    assert.equal(f.changes(), 1);

    const viewport = canvas(v); viewport.scrollLeft = 300; viewport.scrollTop = 200;
    pointer(viewport, 'pointerdown', 200, 200); move(v, 50, 20);
    assert.deepEqual({ x: viewport.scrollLeft, y: viewport.scrollTop }, { x: 250, y: 180 });
    move(v, 950, 600, { buttons: 0 });
    assert.deepEqual({ x: viewport.scrollLeft, y: viewport.scrollTop }, { x: 250, y: 180 });
    move(v, 80, 50); up(v);
    assert.deepEqual({ x: viewport.scrollLeft, y: viewport.scrollTop }, { x: 220, y: 150 });
    assert.equal(f.changes(), 1); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
