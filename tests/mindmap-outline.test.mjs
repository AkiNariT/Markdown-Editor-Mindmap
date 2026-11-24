import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMindmap, serializeMindmap, validateMindmap } from '../src/mindmap.mjs';
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

test('saved outline links retain ancestor levels and same-name sibling occurrences after reopening', () => {
  const file = 'C:/notes/book.md';
  const source = '# Book\n\n## A\n### Details\n\n## B\n### Details\n### Details\n';
  const map = parseMindmap(serializeMindmap(outline.markdownToMindmap(source, { file })));
  assert.equal(map.version, 7);
  const path = map.nodes.at(-1).headingPath;
  assert.deepEqual(path, [
    { level: 1, text: 'Book', occurrence: 1 }, { level: 2, text: 'B', occurrence: 1 },
    { level: 3, text: 'Details', occurrence: 2 },
  ]);
  const changed = source.replace('## B', '## Added\n### Details\n\n## B');
  const heading = outline.findMarkdownHeading(changed, path);
  assert.equal(heading.start, changed.lastIndexOf('### Details'));
  assert.equal(changed.slice(heading.start, heading.end), '### Details');
  assert.equal(outline.findMarkdownHeading(changed.slice(0, heading.start), path), undefined);
  const draft = outline.markdownToMindmap(source);
  assert.equal(draft.version, 6); assert.ok(draft.nodes.every(node => !node.headingPath));
  const synthetic = outline.markdownToMindmap('# First\n# Second', { file }).nodes;
  assert.equal(synthetic[0].headingPath, undefined);
  assert.equal(synthetic[2].headingPath[0].text, 'Second');
  for (const bad of [[], [{ level: 9, text: 'x', occurrence: 1 }], [{ level: 1, text: 'x', occurrence: 0 }], [path[0], path[0]]]) {
    const invalid = structuredClone(map); invalid.nodes[0].headingPath = bad;
    assert.throws(() => validateMindmap(invalid));
  }
  assert.throws(() => validateMindmap({ ...map, version: 6 }));
  const invalid = structuredClone(map); invalid.nodes[0].file = null;
  assert.throws(() => validateMindmap(invalid));
});

test('source heading ranges match the textarea after metadata, definitions, fenced code and nested headings', () => {
  const text = '\ufeff---\r\ntitle: Test\r\n---\r\n\r\n[x]: /note\r\n\r\n> ## Target\r\n\r\n```\r\n## Target\r\n```\r\n\r\nTarget\r\n------\r\n';
  const map = outline.markdownToMindmap(text, { file: 'C:/notes/refs.md' });
  const heading = outline.findMarkdownHeading(text, map.nodes.at(-1).headingPath);
  const source = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
  assert.equal(heading.start, source.lastIndexOf('Target')); assert.equal(source.slice(heading.start, heading.end), 'Target\n------');
});
