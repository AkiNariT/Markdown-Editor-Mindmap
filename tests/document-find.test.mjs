import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { getLocale, setLocale } from '../src/i18n.mjs';
import { createDocumentFind, indexFindMatches, visualFindBlocks, visualMatchRange } from '../src/document-find.mjs';

test('the shared find bar navigates map nodes, respects composition and returns focus on Escape', () => {
  const { window } = new JSDOM('<main><div id="find-bar" hidden><label id="find-scope"></label><input id="find-query"><output id="find-count"></output><button id="find-next"></button><button id="find-previous"></button><button id="find-close"></button></div></main><section id="map" tabindex="0"></section>');
  const doc = window.document, host = doc.getElementById('map'), hits = [];
  const map = { host, findNodes: text => text === '甲' ? ['a', 'b'] : [], revealNode: id => hits.push(id), focus: () => host.focus() };
  const finder = createDocumentFind({ document: doc, getSurface: () => ({ scope: 'mindmap', map }), canOpen: () => true, onOpen() {} });
  const query = doc.getElementById('find-query'), bar = doc.getElementById('find-bar');
  const key = (value, options) => doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, ...options }));
  key('f', { ctrlKey: true }); assert.equal(bar.hidden, false); assert.equal(doc.activeElement, query); assert.ok(host.contains(bar));
  const originalLocale = getLocale();
  try {
    setLocale('en'); finder.refreshLanguage();
    assert.equal(query.placeholder, 'Find node titles or notes'); assert.equal(bar.getAttribute('aria-label'), 'Find map nodes');
  } finally { setLocale(originalLocale); finder.refreshLanguage(); }
  query.dispatchEvent(new window.CompositionEvent('compositionstart')); query.value = '甲'; query.dispatchEvent(new window.Event('input'));
  key('Enter'); assert.deepEqual(hits, []);
  query.dispatchEvent(new window.CompositionEvent('compositionend')); assert.deepEqual(hits, ['a']);
  key('Enter'); assert.equal(doc.getElementById('find-count').textContent, '2 / 2');
  key('Enter', { shiftKey: true }); assert.deepEqual(hits, ['a', 'b', 'a']);
  key('Escape'); assert.equal(bar.hidden, true); assert.equal(doc.activeElement, host); assert.ok(doc.querySelector('main').contains(bar));
  finder.open(); finder.close({ clear: true, focus: false }); assert.equal(query.value, '');
});

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
