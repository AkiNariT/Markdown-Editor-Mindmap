import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://moye.local' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'DOMParser', 'MutationObserver', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name], configurable: true });
}
const { createEditor } = await import('../src/editor.js');
const fixture = '# 我的文档\n\n这是 **粗体** 和 *斜体*，~~删除线~~，以及 [网页](https://example.com)。\n\n- 项目\n  - 子项目\n\n1. 第一项\n2. 第二项\n\n- [x] 完成\n- [ ] 未完成\n\n> 引用文字\n\n| 名称 | 数量 |\n| --- | --- |\n| 中文 | 2 |\n\n![图片](assets/photo.png)\n\n```js\nconst answer = 42;\n```\n\n第一行  \n第二行\n';
test('visual editor renders formats and roundtrip retains meaningful Markdown content', () => {
  const element = document.createElement('div'); document.body.append(element);
  const editor = createEditor(element, fixture);
  try {
    const html = editor.getHTML();
    assert.match(html, /<h1>我的文档<\/h1>/);
    assert.match(html, /<strong>粗体<\/strong>/);
    assert.match(html, /<table/);
    assert.match(html, /data-type="taskList"/);
    assert.match(html, /src="assets\/photo.png"/);
    assert.match(html, /<br/);
    const output = editor.getMarkdown();
    assert.match(output, /# 我的文档/);
    assert.match(output, /\*\*粗体\*\*/);
    assert.match(output, /\[x\] 完成/);
    assert.match(output, /\| 中文\s*\| 2\s*\|/);
    assert.match(output, /assets\/photo\.png/);
    assert.match(output, /```js\nconst answer = 42;/);
    const restored = createEditor(document.createElement('div'), output);
    try { assert.equal(restored.getText(), editor.getText()); } finally { restored.destroy(); }
  } finally { editor.destroy(); element.remove(); }
});
test('format buttons change rich text and serialize normal Markdown', () => {
  const editor = createEditor(document.createElement('div'), '直接编辑');
  try {
    editor.commands.selectAll(); editor.commands.toggleBold();
    assert.equal(editor.getMarkdown(), '**直接编辑**');
    editor.commands.toggleBold(); editor.commands.setHeading({ level: 2 });
    assert.equal(editor.getMarkdown().trimEnd(), '## 直接编辑');
  } finally { editor.destroy(); }
});
test('image serialization survives spaces, parentheses and brackets in paths and alt text', () => {
  const editor = createEditor(document.createElement('div'), '');
  try {
    editor.commands.setImage({ src: '我的 笔记.assets/图片(1).png', alt: '示例[一]' });
    const output = editor.getMarkdown();
    const restored = createEditor(document.createElement('div'), output);
    try {
      assert.match(restored.getHTML(), /<img/);
      assert.match(restored.getHTML(), /alt="示例\[一\]"/);
      assert.match(restored.getHTML(), /%20/);
    } finally { restored.destroy(); }
  } finally { editor.destroy(); }
});

test('code blocks highlight explicit languages and update colors as code changes without altering Markdown', () => {
  const markdown = '```js\nconst answer = 42;\n```\n\n```python\ndef hello():\n    return "你好"\n```';
  const element = document.createElement('div'); document.body.append(element);
  const editor = createEditor(element, markdown);
  try {
    assert.equal(element.querySelector('code.language-js .hljs-keyword')?.textContent, 'const');
    assert.equal(element.querySelector('code.language-python .hljs-keyword')?.textContent, 'def');
    assert.equal(element.querySelector('code.language-python .hljs-string')?.textContent, '"你好"');
    editor.commands.setTextSelection({ from: 1, to: 19 });
    editor.commands.insertContent('const answer = "changed";');
    assert.equal(element.querySelector('code.language-js .hljs-string')?.textContent, '"changed"');
    const output = editor.getMarkdown();
    assert.match(output, /```js\nconst answer = "changed";/);
    assert.match(output, /```python\ndef hello\(\):\n    return "你好"/);
    assert.doesNotMatch(output, /hljs-|<span/);
  } finally { editor.destroy(); element.remove(); }
});

test('automatic code highlighting retains an untagged block and language changes survive reopening', () => {
  const element = document.createElement('div'); document.body.append(element);
  const editor = createEditor(element, '```\ndef greet(name):\n    return "Hello " + name\n```');
  try {
    assert.ok(element.querySelector('pre .hljs-keyword'), 'untagged code should be highlighted automatically');
    assert.match(editor.getMarkdown(), /^```\n/);
    editor.commands.setTextSelection(1);
    editor.commands.updateAttributes('codeBlock', { language: 'python' });
    assert.match(editor.getMarkdown(), /^```python\n/);
    const restored = createEditor(document.createElement('div'), editor.getMarkdown());
    try {
      assert.equal(restored.state.doc.firstChild.attrs.language, 'python');
      assert.equal(restored.getText(), editor.getText());
    } finally { restored.destroy(); }
    editor.commands.updateAttributes('codeBlock', { language: 'plaintext' });
    assert.equal(element.querySelectorAll('pre .hljs-keyword').length, 0);
  } finally { editor.destroy(); element.remove(); }
});

test('Tab and Shift-Tab on a selection spanning code and prose do not remove document formatting', () => {
  const editor = createEditor(document.createElement('div'), '```js\nconst answer = 42;\n```\n\n# Heading\n\n**Important** text');
  try {
    const before = editor.getMarkdown();
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    for (const key of ['Tab', 'Shift-Tab']) {
      editor.commands.keyboardShortcut(key);
      assert.equal(editor.getMarkdown(), before, key);
    }
  } finally { editor.destroy(); }
});

test('background editor state can recover and serialize before mounting, then release its view without losing selection or undo', () => {
  const host = document.createElement('div'); document.body.append(host);
  const editor = createEditor(null, '# Original\n\nBefore recovery');
  try {
    assert.equal(host.childElementCount, 0);
    editor.commands.setContent('# Recovered\n\nSaved draft\n\n```js\nconst answer = 42;\n```', { contentType: 'markdown', emitUpdate: false });
    assert.match(editor.getMarkdown(), /# Recovered\n\nSaved draft/);
    editor.mount(host);
    assert.equal(host.querySelector('h1').textContent, 'Recovered');
    assert.equal(host.querySelector('.hljs-keyword').textContent, 'const');
    editor.commands.setTextSelection(15); editor.commands.insertContent('UNSAVED');
    const modified = editor.getMarkdown(), selection = editor.state.selection.from;
    editor.unmount();
    assert.equal(host.childElementCount, 0);
    assert.equal(editor.getMarkdown(), modified);
    editor.mount(host);
    assert.equal(editor.state.selection.from, selection);
    assert.equal(editor.commands.undo(), true);
    assert.doesNotMatch(editor.getMarkdown(), /UNSAVED/);
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.getMarkdown(), modified);
  } finally { editor.destroy(); host.remove(); }
});
