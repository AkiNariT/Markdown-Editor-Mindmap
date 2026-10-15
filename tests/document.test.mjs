import test from 'node:test';
import assert from 'node:assert/strict';
import { detectUnsupported, safeLink, prepareMarkdown } from '../src/document.mjs';
test('comments, footnotes and math still require copy protection alongside valid metadata', () => {
  const reasons = detectUnsupported('---\ntitle: 我的笔记\n---\n\n<!-- 私密注释 -->\n\n公式 $x^2$\n\n[^a]: 注解');
  assert.ok(reasons.some(s => s.includes('HTML')));
  assert.ok(reasons.some(s => s.includes('脚注')));
  assert.ok(reasons.some(s => s.includes('公式')));
});

test('valid YAML alone is preserved without requiring a copy, while malformed YAML remains protected', () => {
  assert.deepEqual(detectUnsupported('---\nname: my-skill\ndescription: 使用场景\nmetadata:\n  category: test\n---\n\n# 正文\n'), []);
  assert.ok(detectUnsupported('---\nname: [broken\n---\n\n# 正文\n').some(value => value.includes('YAML')));
});

test('malformed YAML with trailing whitespace on delimiter lines still requires protection', () => {
  for (const value of ['---  \nname: [broken\n---\n\n# 正文', '---\nname: [broken\n---  \n\n# 正文', '\ufeff---\t\r\nname: [broken\r\n... \r\n\r\n# 正文']) {
    assert.ok(detectUnsupported(value).some(reason => reason.includes('YAML')));
  }
});
test('code fences and inline code do not trigger unsupported protection', () => {
  assert.deepEqual(detectUnsupported('# 正文\n\n```html\n<!-- sample -->\n$x$\n```\n\n`<div>` 和 `$a$`'), []);
});
test('only web and email links can launch externally', () => {
  assert.equal(safeLink('https://example.com/a'), true);
  assert.equal(safeLink('mailto:a@example.com'), true);
  assert.equal(safeLink('javascript:alert(1)'), false);
  assert.equal(safeLink('file:///C:/secret.txt'), false);
  assert.equal(safeLink('cmd:calc'), false);
});
test('edited serialization preserves original BOM and newline convention', () => {
  assert.equal(prepareMarkdown('# 改动\n\n内容', '\ufeff# 原文\r\n'), '\ufeff# 改动\r\n\r\n内容\r\n');
  assert.equal(prepareMarkdown('# 新文档', ''), '# 新文档\n');
});
test('HTML nested inside a list is protected rather than mistaken for indented code', () => {
  assert.ok(detectUnsupported('- 列表\n\n    <!-- 保留注释 -->\n\n    正文').some(value => value.includes('HTML')));
  assert.deepEqual(detectUnsupported('    <!-- 代码示例 -->\n'), []);
});
test('unmatched backticks cannot hide comments across separate paragraphs', () => {
  assert.ok(detectUnsupported('正文 `未闭合\n\n<!-- 保留注释 -->\n\n下段 `').some(value => value.includes('HTML')));
});
test('wiki links embedded within a paragraph require copy protection', () => {
  assert.ok(detectUnsupported('正文 [[笔记]] 继续。').some(value => value.includes('双向链接')));
});
