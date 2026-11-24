import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexFindMatches, visualFindBlocks, visualMatchRange } from '../src/document-find.mjs';

test('literal, non-overlapping search retains Unicode offsets and navigates in either direction', () => {
  const result = indexFindMatches([{ text: '😀Ａ a.b\n中文 A.B 中文' }], 'a.b');
  assert.equal(result.count, 2);
  assert.deepEqual([result.at(0).from, result.at(1).from, result.at(-1).from, result.at(2).from], [4, 11, 11, 4]);
  assert.equal(indexFindMatches([{ text: '中文中文' }], '中文').count, 2);
  assert.equal(indexFindMatches([{ text: 'aaa' }], 'aa').count, 1);
  assert.equal(indexFindMatches([{ text: 'a' }], '').count, 0);
  assert.equal(indexFindMatches([{ text: 'a' }], 'x').at(0), null);
});

test('rendered search spans emphasis and syntax highlighting but stops at blocks, images and hard breaks', () => {
  const doc = new JSDOM('<main><h2>中<strong>文</strong></h2><p>中<img>文<br>字</p><pre><code><span>中</span>文</code></pre></main>').window.document;
  const blocks = visualFindBlocks(doc.querySelector('main'));
  const result = indexFindMatches(blocks, '中文');
  assert.equal(result.count, 2);
  assert.equal(visualMatchRange(result.at(0)).toString(), '中文');
  assert.equal(visualMatchRange(result.at(1)).toString(), '中文');
  assert.equal(indexFindMatches(blocks, '文中').count, 0);
  assert.equal(indexFindMatches(blocks, '文字').count, 0);
});

test('late hits in a long source line keep exact offsets', () => {
  const many = indexFindMatches([{ text: 'x '.repeat(100_000) }], 'x');
  assert.equal(many.count, 100_000);
  assert.equal(many.at(99_999).from, 199_998);
});
