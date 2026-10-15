import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createMindmap, validateMindmap, parseMindmap, serializeMindmap } from '../src/mindmap.mjs';
import { serializeMindmapForPath } from '../src/mindmap-files.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://md.local' });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
const { createMindmapView } = await import('../src/mindmap-view.js');
const { setLocale } = await import('../src/i18n.mjs');
const initial = () => ({ ...createMindmap(), version: 4, nodes: [
  { id: 'root', parent: null, text: '中心主题', file: null, collapsed: false },
  { id: 'a', parent: 'root', text: '关联文档', file: 'C:/notes/a.md', collapsed: false, offset: { x: 21, y: -13 } },
], connections: [{ id: 'edge', from: 'root', to: 'a', label: '关系说明' }] });
const change = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
const mount = t => {
  const view = createMindmapView(initial()); document.body.append(view.host);
  t.after(() => { view.destroy(); setLocale('zh-CN'); }); return view;
};

test('whole-map themes roundtrip in v5, keep links/layout/relations, and reject unsupported themes and older schema', () => {
  for (const theme of ['classic', 'rounded', 'capsule', 'tree', 'vine', 'crystal']) {
    const source = { ...initial(), version: 5, theme };
    assert.deepEqual(parseMindmap(serializeMindmap(source)), source);
    const saved = JSON.parse(serializeMindmapForPath(source, 'C:/notes/maps/map.mdmap', path.win32));
    assert.equal(saved.theme, theme); assert.equal(saved.nodes[1].file, '../a.md');
    assert.deepEqual(saved.nodes[1].offset, { x: 21, y: -13 });
    assert.equal(saved.connections[0].label, '关系说明');
  }
  for (const theme of ['', null, 'unknown', 'tree vine', '__proto__']) assert.throws(() => validateMindmap({ ...initial(), version: 5, theme }));
  for (const version of [1, 2, 3, 4]) assert.throws(() => validateMindmap({ ...createMindmap(), version, ...(version >= 2 ? { connections: [] } : {}), theme: 'vine' }));
  assert.deepEqual(validateMindmap(initial()), initial(), 'old maps do not gain a theme or change their data');
});

test('fixed palettes apply both colors in one undo step, reset both and preserve old custom colors until chosen', t => {
  const view = mount(t), host = view.host;
  assert.equal(host.querySelectorAll('input[type=color]').length, 0, 'native free-form pickers are removed');
  const choices = host.querySelectorAll('[data-palette]'); assert.equal(choices.length, 8);
  host.querySelector('[data-node-id=a]').click();
  const before = view.getData(); host.querySelector('[data-palette=blue]').click();
  const painted = view.getData();
  assert.match(painted.nodes[1].background, /^#[a-f\d]{6}$/); assert.match(painted.nodes[1].color, /^#[a-f\d]{6}$/);
  assert.deepEqual(painted.nodes[0], before.nodes[0], 'palette affects only selected node');
  assert.equal(host.querySelector('[data-palette=blue]').getAttribute('aria-pressed'), 'true');
  assert.equal(view.undo(), true); assert.deepEqual(view.getData(), before);
  assert.equal(view.redo(), true); assert.deepEqual(view.getData(), painted);
  host.querySelector('[data-palette=default]').click();
  assert.equal(view.getData().nodes[1].background, undefined); assert.equal(view.getData().nodes[1].color, undefined);
  view.undo(); assert.deepEqual(view.getData(), painted);
  const old = initial(); Object.assign(old.nodes[1], { background: '#123456', color: '#abcdef', style: 'double' });
  view.setSaved(old); assert.deepEqual(view.getData(), old); assert.equal(JSON.parse(view.getText()).nodes[1].style, 'double');
  assert.equal([...choices].filter(button => button.getAttribute('aria-pressed') === 'true').length, 0, 'legacy colors are not mislabeled as a preset');
});

test('theme changes apply to the entire map, undo atomically, and preserve node data, relation labels and geometry', t => {
  const view = mount(t), host = view.host, select = host.querySelector('[aria-label="整图风格"]');
  assert.ok(select); assert.deepEqual([...select.options].map(option => option.value), ['classic', 'rounded', 'capsule', 'tree', 'vine', 'crystal']);
  const before = view.getData(), cards = () => [...host.querySelectorAll('[data-node-card]')];
  const positions = cards().map(card => [card.style.left, card.style.top]);
  for (const theme of ['tree', 'vine', 'crystal']) {
    change(select, theme); assert.equal(view.getData().theme, theme); assert.equal(view.getData().version, 5);
    assert.equal(host.dataset.mapTheme, theme); assert.deepEqual(view.getData().nodes, before.nodes);
    assert.deepEqual(cards().map(card => [card.style.left, card.style.top]), positions);
    assert.equal(host.querySelectorAll('.mindmap-node-art').length, 2);
    assert.ok(host.querySelector('.mindmap-branch')); assert.equal(host.querySelector('[data-connection-label=edge]').textContent, '关系说明');
    assert.equal(view.undo(), true); assert.deepEqual(view.getData(), before); assert.equal(host.dataset.mapTheme, 'classic');
  }
  view.redo(); const reopened = JSON.parse(view.getText()); view.setSaved(reopened); assert.equal(host.dataset.mapTheme, 'crystal');
  setLocale('en'); assert.equal(select.getAttribute('aria-label'), 'Map style'); assert.equal(select.value, 'crystal');
  assert.equal(select.selectedOptions[0].textContent, 'Crystal');
});

test('palette and theme mutations obey read/lock/IME permissions and destroyed views', t => {
  const view = mount(t), host = view.host, select = host.querySelector('[aria-label="整图风格"]'), blue = host.querySelector('[data-palette=blue]');
  assert.ok(select); assert.ok(blue); const before = view.getText();
  for (const mode of ['read', 'lock', 'ime']) {
    if (mode === 'read') view.setEditable(false);
    if (mode === 'lock') view.setLocked(true);
    if (mode === 'ime') host.querySelector('.mindmap-text-input').dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    assert.equal(select.disabled, true); assert.equal(blue.disabled, true);
    change(select, 'vine'); blue.click(); assert.equal(view.getText(), before);
    if (mode === 'read') view.setEditable(true);
    if (mode === 'lock') view.setLocked(false);
    if (mode === 'ime') host.querySelector('.mindmap-text-input').dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  }
  view.destroy(); change(select, 'tree'); blue.click(); assert.equal(view.getText(), before);
});

test('legacy per-node shapes have an honest selector state and can switch directly to Classic', t => {
  const view = mount(t), old = initial(); old.nodes[1].style = 'capsule';
  view.setSaved(old); const select = view.host.querySelector('[aria-label="整图风格"]');
  assert.equal(select.value, 'legacy'); assert.equal(select.selectedOptions[0].textContent, '原有样式');
  change(select, 'classic'); assert.equal(view.getData().theme, 'classic'); assert.equal(view.host.classList.contains('mindmap-explicit-theme'), true);
  assert.equal(select.querySelector('[value=legacy]'), null);
  view.undo(); assert.deepEqual(view.getData(), old); assert.equal(select.value, 'legacy');
});

test('every fixed background/text pair has readable contrast', async () => {
  const { nodePalettes } = await import('../src/mindmap-themes.mjs');
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return r * .2126 + g * .7152 + b * .0722;
  };
  for (const palette of nodePalettes.filter(palette => palette.background)) {
    const a = luminance(palette.background), b = luminance(palette.color);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, palette.id);
  }
});
