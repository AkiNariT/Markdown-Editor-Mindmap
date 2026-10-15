import test from 'node:test';
import assert from 'node:assert/strict';
import { toSourceText, fromSourceText } from '../src/source.mjs';

test('view-only source is lossless for BOM, mixed line endings, lone CR and trailing blanks', () => {
  for (const [original, display] of [
    ['\ufeff# Header\r\n\r\nFirst line.\n\nLast line.\r\n\n', '# Header\n\nFirst line.\n\nLast line.\n\n'],
    ['first\rsecond\r', 'first\nsecond\n'],
    ['first\r\nsecond\nthird\r', 'first\nsecond\nthird\n'],
    ['\ufeffplain text', 'plain text'],
    ['', ''],
  ]) {
    assert.equal(toSourceText(original), display);
    assert.equal(fromSourceText(display, original), original);
  }
});

test('source edits retain BOM and existing CRLF, LF or CR convention without adding final newlines', () => {
  assert.equal(fromSourceText('new\ntext\n\n', '\ufeffold\r\n'), '\ufeffnew\r\ntext\r\n\r\n');
  assert.equal(fromSourceText('new\ntext', 'old\n'), 'new\ntext');
  assert.equal(fromSourceText('new\ntext\n', 'old\r'), 'new\rtext\r');
});
