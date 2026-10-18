import test from 'node:test';
import assert from 'node:assert/strict';
const outline = await import('../src/mindmap-outline.mjs').catch(error => { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {}; });

test('Markdown headings produce an ordered hierarchy without treating fenced examples or body text as topics', () => {
  assert.equal(typeof outline.markdownToMindmap, 'function');
  const text = '# Lecture\nBody stays here.\n## **One** &amp; [link](https://example.com)\n### Child `code`\n```md\n# Not a topic\n```\n~~~\n## Neither\n~~~\n## Two\nEnd.';
  const result = outline.markdownToMindmap(text, { file: 'C:/notes/lecture.md' });
  assert.deepEqual(result.nodes.map(n => n.text), ['Lecture', 'One & link', 'Child code', 'Two']);
  assert.deepEqual(result.nodes.map(n => n.parent), [null, 'root', result.nodes[1].id, 'root']);
  assert.ok(result.nodes.every(n => n.file === 'C:/notes/lecture.md'));
  assert.match(text, /Body stays here/);
});

test('setext headings, skipped levels and multiple top-level headings use a single safe root', () => {
  assert.equal(typeof outline.markdownToMindmap, 'function');
  const result = outline.markdownToMindmap('First\n=====\n### Deep\nSecond\n=====\nPart\n-----', { title: 'Document' });
  assert.deepEqual(result.nodes.map(n => n.text), ['Document', 'First', 'Deep', 'Second', 'Part']);
  assert.equal(result.nodes[1].parent, result.root); assert.equal(result.nodes[2].parent, result.nodes[1].id);
  assert.equal(result.nodes[3].parent, result.root); assert.equal(result.nodes[4].parent, result.nodes[3].id);
  assert.ok(result.nodes.every(n => n.file === null));
});

test('front matter, indented code, fenced closers and escaped ATX markers do not fabricate headings', () => {
  assert.equal(typeof outline.markdownToMindmap, 'function');
  const result = outline.markdownToMindmap('---\ntitle: Metadata\n---\n# Real\n    # Indented\n\\# Escaped\n````md\n```\n# Still code\n````\n## Visible');
  assert.deepEqual(result.nodes.map(n => n.text), ['Real', 'Visible']);
});

test('no-heading input and over-limit outlines are rejected instead of silently truncating content', () => {
  assert.equal(typeof outline.markdownToMindmap, 'function');
  assert.throws(() => outline.markdownToMindmap('Only a paragraph.'), /标题|heading/i);
  assert.throws(() => outline.markdownToMindmap('# ' + 'x'.repeat(501)), /500/);
  assert.throws(() => outline.markdownToMindmap(Array.from({ length: 1001 }, (_, i) => '# ' + i).join('\n')), /1000/);
});

test('inline-code text remains literal while ordinary heading entities and emphasis become readable text', () => {
  const result = outline.markdownToMindmap('# `&amp;` &amp; **bold**\n## <em>Formatted</em> ![alt](picture.png)');
  assert.deepEqual(result.nodes.map(n => n.text), ['&amp; & bold', 'Formatted alt']);
});

test('heading import decodes HTML named entities without changing inline code or unterminated references', () => {
  const result = outline.markdownToMindmap('# Copyright &copy; 2026\n## A &mdash; B &hellip;\n### `&copy; &mdash; &hellip;` &copy');
  assert.deepEqual(result.nodes.map(n => n.text), ['Copyright © 2026', 'A — B …', '&copy; &mdash; &hellip; &copy']);
});
