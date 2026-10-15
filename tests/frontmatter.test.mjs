import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { splitFrontmatter, composeMarkdown, validateSkillFields } from '../src/frontmatter.mjs';

const header = '\ufeff---\r\n# keep header\r\nname: my-skill # keep name\r\ndescription: >- # keep description\r\n  完成一个任务。\r\n  当用户提出请求时使用。\r\nmetadata:\r\n  category: "sample"\r\n  count: 012\r\n  items: [one, two]\r\n---\r\n\r\n';

test('frontmatter is separated from prose with exact BOM, line endings, comments and gap retained', () => {
  const original = header + '# 正文\r\n\r\n内容。\r\n';
  const parts = splitFrontmatter(original);
  assert.equal(parts.prefix, header);
  assert.equal(parts.prefix + parts.body, original);
  assert.deepEqual(parts.skill, { name: 'my-skill', description: '完成一个任务。 当用户提出请求时使用。' });
});

test('editing only the body preserves every original header byte', () => {
  assert.equal(composeMarkdown('# 修改后的正文\n\n内容。', header + '# 原文\r\n'), header + '# 修改后的正文\r\n\r\n内容。\r\n');
});

test('source display retains invalid skill drafts while ordinary saving still validates', () => {
  const values = { name: 'INVALID_NAME', description: '' };
  const draft = composeMarkdown('# 草稿', header + '# 原文\r\n', values, { validate: false });
  assert.deepEqual(splitFrontmatter(draft).skill, values);
  assert.ok(draft.includes('# keep header\r\n'));
  assert.ok(draft.includes('items: [one, two]\r\n'));
  assert.throws(() => composeMarkdown('# 草稿', header + '# 原文\r\n', values), /技能名称/);
});

test('changing skill fields preserves other fields, comments and CRLF, while quotes and newlines remain valid YAML', () => {
  const values = { name: 'new-skill', description: '处理 "引用" 与 : 冒号\n在用户请求时使用。' };
  const result = composeMarkdown('# 正文', header + '# 原文\r\n', values);
  const parts = splitFrontmatter(result);
  assert.deepEqual(parts.skill, values);
  assert.ok(result.startsWith('\ufeff---\r\n# keep header\r\n'));
  assert.ok(result.includes('# keep name\r\n'));
  assert.ok(result.includes('# keep description\r\n'));
  assert.ok(result.includes('metadata:\r\n  category: "sample"\r\n  count: 012\r\n  items: [one, two]\r\n'));
  assert.deepEqual(parse(parts.yaml).metadata, parse(splitFrontmatter(header + '# 原文').yaml).metadata);
  assert.equal(/(?<!\r)\n/.test(result), false);
});

test('flow mappings and reversed field order are patched without changing unknown properties', () => {
  const original = '---\n{description: "old", name: my-skill, metadata: {x: [1, 2]}}\n...\n\n# 文字\n';
  const result = composeMarkdown('# 新文字', original, { name: 'other-skill', description: '"yes": description' });
  const parts = splitFrontmatter(result);
  assert.deepEqual(parts.skill, { name: 'other-skill', description: '"yes": description' });
  assert.ok(result.includes('metadata: {x: [1, 2]}'));
  assert.ok(result.includes('\n...\n\n'));
});

test('invalid, unclosed and non-frontmatter fences are not treated as supported metadata', () => {
  assert.equal(splitFrontmatter('---\nname: [broken\n---\n# 原文'), null);
  assert.equal(splitFrontmatter('---\nname: foo\n# 原文'), null);
  assert.equal(splitFrontmatter('# 正文\n\n---\nname: foo\n---\n'), null);
});

test('generic YAML and anchored skill fields remain opaque while the body stays editable', () => {
  for (const yaml of ['title: 标题\ncustom: !tag value\n', 'name: &shared my-skill\ndescription: 文本\nreference: *shared\n', '- one\n- two\n']) {
    const original = '---\n' + yaml + '---\n\n# 正文\n';
    assert.equal(splitFrontmatter(original).skill, null);
    assert.equal(composeMarkdown('# 修改', original), '---\n' + yaml + '---\n\n# 修改\n');
  }
});

test('invalid skill fields cannot be serialized into a saved document', () => {
  for (const name of ['', 'Name', 'bad name', '-bad', 'bad--name', 'a'.repeat(65)]) {
    assert.throws(() => validateSkillFields({ name, description: '正常说明' }), /名称/);
  }
  for (const description of ['', '  ', '<tag>', 'a'.repeat(1025)]) {
    assert.throws(() => validateSkillFields({ name: 'valid-name', description }), /用途/);
  }
  assert.throws(() => composeMarkdown('# 正文', header + '# 原文', { name: 'Invalid', description: '有效说明' }), /名称/);
});

test('a frontmatter-only document without a final newline gains a safe boundary before new prose', () => {
  const original = '---\nname: my-skill\ndescription: 用途\n---';
  const result = composeMarkdown('# 新正文', original);
  assert.ok(result.startsWith(original + '\n\n'));
  assert.equal(splitFrontmatter(result).body, '# 新正文\n');
});
