import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://moye.local' });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { createMindmapView } = await import('../src/mindmap-view.js');
const { setLocale } = await import('../src/i18n.mjs');
function fixture(options = {}) {
  const errors = [];
  const view = createMindmapView({ format: 'md-mindmap', version: 2, root: 'r', nodes: [
    { id: 'r', parent: null, text: '课程', file: null, collapsed: false },
    { id: 'a', parent: 'r', text: '这是需要完整显示的很长的课程标题'.repeat(8), file: null, collapsed: false, offset: { x: 80, y: 900 } },
    { id: 'b', parent: 'r', text: '总结', file: null, collapsed: false },
  ], connections: [{ id: 'ab', from: 'a', to: 'b' }] }, { onError: value => errors.push(value), ...options });
  document.body.append(view.host);
  return { view, errors, close() { view.destroy(); setLocale('zh-CN'); } };
}
function select(view, selector, value) {
  const input = view.host.querySelector(selector); assert.ok(input, selector);
  input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('map line and size controls preserve values, undo and reading protection', () => {
  const f = fixture(), { view } = f;
  try {
    select(view, '.mindmap-line-style', 'orthogonal');
    assert.equal(view.getData().lineStyle, 'orthogonal'); assert.equal(view.getData().version, 6);
    assert.ok([...view.host.querySelectorAll('.mindmap-branch')].every(path => !/[CQ]/.test(path.getAttribute('d'))));
    select(view, '.mindmap-node-size', 'wide'); assert.equal(view.getData().nodeSize, 'wide');
    assert.equal(parseFloat(view.host.querySelector('[data-node-card="a"]').style.width), 320);
    assert.ok(view.undo()); assert.equal(view.getData().nodeSize, undefined);
    view.setEditable(false); assert.equal(view.host.querySelector('.mindmap-line-style').disabled, true);
    select(view, '.mindmap-line-style', 'straight'); assert.equal(view.getData().lineStyle, 'orthogonal');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('long titles and notes grow nodes; compact layout is reversible', () => {
  const f = fixture(), { view } = f;
  try {
    view.host.querySelector('[data-node-id="a"]').click();
    const card = view.host.querySelector('[data-node-card="a"]');
    assert.ok(parseFloat(card.style.height) > 96);
    const input = view.host.querySelector('.mindmap-subtitle-input'); assert.ok(input);
    input.value = '概括与备注'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('blur'));
    assert.equal(view.getData().nodes[1].subtitle, '概括与备注');
    assert.equal(view.host.querySelector('[data-node-card="a"] .mindmap-node-subtitle').textContent, '概括与备注');
    view.host.querySelector('.mindmap-compact').click(); assert.equal(view.getData().nodes[1].offset, undefined);
    view.undo(); assert.deepEqual(view.getData().nodes[1].offset, { x: 80, y: 900 });
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('relationship styles and arrowheads are visible and undoable', () => {
  const f = fixture(), { view } = f;
  try {
    view.host.querySelector('[data-connection-id="ab"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    select(view, '.mindmap-edge-style', 'solid'); select(view, '.mindmap-edge-arrow', 'both'); select(view, '.mindmap-edge-color', '#357db4');
    const edge = view.getData().connections[0]; assert.equal(edge.style, 'solid'); assert.equal(edge.arrow, 'both'); assert.equal(edge.color, '#357db4');
    const path = view.host.querySelector('[data-connection-line="ab"]'); assert.equal(path.style.strokeDasharray, 'none');
    assert.ok(path.hasAttribute('marker-start')); assert.ok(path.hasAttribute('marker-end'));
    assert.equal(view.host.querySelector('marker').getAttribute('markerUnits'), 'userSpaceOnUse', 'selection must not enlarge arrowheads on a short relationship');
    view.undo(); assert.equal(view.getData().connections[0].color, undefined);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('export options are available while reading without making the map dirty', async () => {
  const calls = []; const f = fixture({ onExport: async value => calls.push(value) }), { view } = f;
  try {
    const before = view.getText(); view.setEditable(false);
    view.host.querySelector('.mindmap-export').click();
    select(view, '.mindmap-export-format', 'svg'); select(view, '.mindmap-export-preset', '16:10'); select(view, '.mindmap-export-scope', 'chapters');
    view.host.querySelector('.mindmap-export-confirm').click(); await tick();
    assert.deepEqual(calls, [{ format: 'svg', preset: '16:10', scope: 'chapters' }]);
    assert.equal(view.getText(), before); assert.equal(view.undo(), false);
    setLocale('en'); assert.equal(view.host.querySelector('.mindmap-export').textContent, 'Export');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
