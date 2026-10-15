import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://moye.local' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'DOMParser', 'MutationObserver', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name], configurable: true });
}
const { setLocale } = await import('../src/i18n.mjs');
const { createMindmapView } = await import('../src/mindmap-view.js');
const { createMindmap, validateMindmap, serializeMindmap } = await import('../src/mindmap.mjs');
const { createSourceEditor } = await import('../src/source.mjs');
const { createEditor } = await import('../src/editor.js');
const data = () => ({ ...createMindmap(), nodes: [
  { id: 'root', parent: null, text: '中心主题', file: null, collapsed: false },
  { id: 'child', parent: 'root', text: '新主题', file: '中文 文档.md', collapsed: false },
] });
const node = (view, id) => view.host.querySelector(`[data-node-id="${id}"]`);
const button = (view, text) => [...view.host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === text);
const pointer = (target, type, x, y) => { const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event); };

test('mind map language switches update existing and background UI without replacing content, input or undo history', () => {
  setLocale('zh-CN'); let changes = 0;
  const view = createMindmapView(data(), { onChange: () => changes++, onLink: () => {}, onOpen: () => {} });
  const background = createMindmapView(data());
  document.body.append(view.host);
  try {
    node(view, 'child').click();
    const input = view.host.querySelector('input'); input.focus(); input.value = '用户文字'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
    input.setSelectionRange(1, 3); input.scrollLeft = 20;
    const canvas = view.host.querySelector('.mindmap-canvas'); canvas.scrollLeft = 123; canvas.scrollTop = 234;
    const original = view.getText(), selected = view.captureSessionState().selected, count = changes;
    setLocale('en');
    assert.ok(button(view, 'Link Markdown')); assert.ok(button(background, 'Child topic'));
    assert.equal(view.host.querySelector('input'), input); assert.equal(input.value, '用户文字');
    assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3); assert.equal(input.scrollLeft, 20);
    assert.equal(canvas.scrollLeft, 123); assert.equal(canvas.scrollTop, 234);
    assert.equal(view.getText(), original); assert.equal(changes, count); assert.equal(view.captureSessionState().selected, selected);
    assert.equal(node(view, 'root').textContent, '中心主题');
    assert.equal(view.host.querySelector('.mindmap-file').getAttribute('aria-label'), 'Open linked file: 中文 文档.md');
    assert.equal(view.undo(), true); assert.equal(view.getData().nodes[1].text, '新主题');
    assert.equal(view.redo(), true); assert.equal(view.getData().nodes[1].text, '用户文字');
    input.focus(); input.dispatchEvent(new dom.window.CompositionEvent('compositionstart')); input.value = '未提交的输入'; input.setSelectionRange(2, 4);
    const beforeComposition = view.getText(); setLocale('zh-CN');
    assert.equal(input.value, '未提交的输入'); assert.equal(input.selectionStart, 2); assert.equal(view.isComposing(), true); assert.equal(view.getText(), beforeComposition);
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend')); assert.equal(view.getData().nodes[1].text, '未提交的输入');
    background.destroy(); setLocale('en'); assert.equal(background.host.getAttribute('aria-label'), '思维导图', 'destroy unsubscribes locale listener');
  } finally { view.destroy(); background.destroy(); setLocale('zh-CN'); }
});

test('language switches preserve active context menu, drag and pan gestures', () => {
  setLocale('zh-CN'); const view = createMindmapView(data()); document.body.append(view.host);
  try {
    node(view, 'child').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
    const menu = view.host.querySelector('[role="menu"]'), first = menu.querySelector('[data-action="edit"]'); first.focus();
    setLocale('en'); assert.equal(view.host.querySelector('[role="menu"]'), menu); assert.equal(first.textContent, 'Edit text'); assert.equal(document.activeElement, first);
    assert.match(menu.querySelector('.mindmap-menu-header').textContent, /^Selected node: 新主题$/);
    const canvas = view.host.querySelector('.mindmap-canvas');
    pointer(node(view, 'child'), 'pointerdown', 200, 200); pointer(canvas, 'pointermove', 220, 210);
    setLocale('zh-CN'); pointer(canvas, 'pointermove', 240, 220); pointer(canvas, 'pointerup', 240, 220);
    assert.deepEqual(view.getData().nodes[1].offset, { x: 40, y: 20 });
    canvas.scrollLeft = 100; canvas.scrollTop = 100;
    pointer(canvas, 'pointerdown', 400, 300); pointer(canvas, 'pointermove', 380, 290);
    setLocale('en'); pointer(canvas, 'pointermove', 360, 280); pointer(canvas, 'pointerup', 360, 280);
    assert.equal(canvas.scrollLeft, 140); assert.equal(canvas.scrollTop, 120);
  } finally { view.destroy(); setLocale('zh-CN'); }
});

test('only newly created map topics use current language, and validation errors are localized', () => {
  setLocale('zh-CN'); const old = createMindmap(), serialized = serializeMindmap(old);
  setLocale('en'); const view = createMindmapView(old);
  try {
    assert.equal(createMindmap().nodes[0].text, 'Central topic'); assert.equal(serializeMindmap(old), serialized);
    button(view, 'Child topic').click(); assert.equal(view.getData().nodes[1].text, 'New topic');
    setLocale('zh-CN'); assert.equal(view.getData().nodes[1].text, 'New topic');
    setLocale('en'); assert.throws(() => validateMindmap({}), /not a valid MD mind map/);
  } finally { view.destroy(); setLocale('zh-CN'); }
});

test('translated controls compensate viewport geometry while keeping an active pan continuous', () => {
  setLocale('zh-CN'); const view = createMindmapView(data()); document.body.append(view.host);
  try {
    const canvas = view.host.querySelector('.mindmap-canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 600 }); Object.defineProperty(canvas, 'clientHeight', { value: 300 });
    canvas.getBoundingClientRect = () => ({ left: 0, top: button(view, 'Child topic') ? 80 : 40 });
    canvas.scrollLeft = 100; canvas.scrollTop = 100;
    pointer(canvas, 'pointerdown', 400, 300); pointer(canvas, 'pointermove', 380, 290);
    const position = canvas.getBoundingClientRect().top - canvas.scrollTop;
    setLocale('en'); assert.equal(canvas.getBoundingClientRect().top - canvas.scrollTop, position);
    pointer(canvas, 'pointermove', 360, 280); pointer(canvas, 'pointerup', 360, 280);
    assert.equal(canvas.scrollLeft, 140); assert.equal(canvas.scrollTop, 160);
    assert.equal(view.getData().nodes[1].offset, undefined);
  } finally { view.destroy(); setLocale('zh-CN'); }
});

test('source labels update without changing input, selection, scroll, composition or shared history', () => {
  setLocale('zh-CN'); let changes = 0; const source = createSourceEditor(() => changes++); document.body.append(source.host);
  try {
    source.setText('第一行\n第二行'); source.input.readOnly = false; source.input.focus(); source.input.setSelectionRange(5, 7);
    source.input.scrollTop = 45; source.input.scrollLeft = 88; source.refresh();
    const before = { text: source.getText(), start: source.input.selectionStart, end: source.input.selectionEnd };
    setLocale('en'); assert.equal(source.input.getAttribute('aria-label'), 'Markdown source'); assert.match(source.host.querySelector('.source-position').textContent, /^Line 2 · Column /);
    assert.deepEqual({ text: source.getText(), start: source.input.selectionStart, end: source.input.selectionEnd }, before);
    assert.equal(source.input.scrollTop, 45); assert.equal(source.input.scrollLeft, 88); assert.equal(changes, 0);
    source.setText('改过的正文', { record: true }); setLocale('zh-CN'); assert.equal(source.undo(), true); assert.equal(source.getText(), before.text);
    source.input.dispatchEvent(new dom.window.CompositionEvent('compositionstart')); source.input.value = '正在组合'; setLocale('en');
    assert.equal(source.input.value, '正在组合'); source.input.dispatchEvent(new dom.window.CompositionEvent('compositionend'));
    source.destroy(); setLocale('zh-CN'); assert.equal(source.input.getAttribute('aria-label'), 'Markdown source');
  } finally { source.destroy(); source.host.remove(); setLocale('zh-CN'); }
});

test('visual editor updates placeholder and image messages without transactions or content changes', async () => {
  setLocale('zh-CN'); const host = document.createElement('div'), emptyHost = document.createElement('div'); document.body.append(host, emptyHost);
  const editor = createEditor(host, '保留中文 **正文**\n\n![用户标题](a.png)', { imageURL: value => value });
  const empty = createEditor(emptyHost, ''); let transactions = 0;
  editor.on('transaction', () => transactions++); empty.on('transaction', () => transactions++);
  try {
    editor.commands.setTextSelection({ from: 2, to: 4 }); transactions = 0;
    const state = editor.state, text = editor.getMarkdown();
    editor.view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    assert.equal(editor.view.composing, true);
    setLocale('en'); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(editor.state, state); assert.equal(editor.getMarkdown(), text); assert.equal(transactions, 0);
    assert.equal(editor.view.composing, true, 'language change does not end visual IME composition');
    assert.equal(editor.view.dom.getAttribute('aria-label'), 'Document body');
    assert.equal(host.querySelector('.image-error').textContent, 'Unable to load image');
    assert.equal(host.querySelector('img').alt, '用户标题');
    assert.equal(emptyHost.querySelector('[data-placeholder]').getAttribute('data-placeholder'), 'Write your first sentence…');
    editor.view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    empty.destroy(); editor.destroy(); setLocale('zh-CN');
  } finally { if (!editor.isDestroyed) editor.destroy(); if (!empty.isDestroyed) empty.destroy(); host.remove(); emptyHost.remove(); setLocale('zh-CN'); }
});
