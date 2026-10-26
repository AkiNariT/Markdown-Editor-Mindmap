import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseImages } from '../src/images.mjs';
import path from 'node:path';

test('Mac Save As rebases images between distinct directories differing only by case', () => {
  assert.equal(rebaseImages('![图](assets/pic.png)', '/notes/Plan', '/notes/plan', { platform: 'darwin', pathApi: path.posix }), '![图](../Plan/assets/pic.png)');
});

test('Windows Save As retains the existing case-insensitive directory comparison', () => {
  assert.equal(rebaseImages('![图](pic.png)', 'C:/notes/Plan', 'c:/notes/plan', { platform: 'win32', pathApi: path.win32 }), '![图](pic.png)');
});
test('Save As rebases inline destination without replacing matching alt text', () => {
  assert.equal(rebaseImages('![pic.png](pic.png)\n', 'C:/notes', 'C:/notes/copy'), '![pic.png](../pic.png)\n');
});
test('Save As rebases reference-style image definitions while preserving markup', () => {
  assert.equal(rebaseImages('![示例][img]\n\n[img]: assets/pic.png "标题"\n', 'C:/notes', 'C:/notes/copy'), '![示例][img]\n\n[img]: ../assets/pic.png "标题"\n');
});
test('Save As does not modify image examples in fenced code or remote images', () => {
  assert.equal(rebaseImages('```md\n![示例](a.png)\n```\n\n![图片](https://example.com/a.png)\n', 'C:/notes', 'C:/notes/copy'), '```md\n![示例](a.png)\n```\n\n![图片](https://example.com/a.png)\n');
});
test('Save As leaves a code example intact when the same image markup occurs outside code', () => {
  assert.equal(rebaseImages('```md\n![示例](a.png)\n```\n\n![示例](a.png)\n', 'C:/notes', 'C:/notes/copy'), '```md\n![示例](a.png)\n```\n\n![示例](../a.png)\n');
});
