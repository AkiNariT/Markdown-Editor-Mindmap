import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFilesFromTransfer, readImagePayloads, imageMarkdown, importAtTarget, imageURLForDocument } from '../src/image-transfer.mjs';

const png = () => new File([new Uint8Array([137, 80, 78, 71])], '截图.png', { type: 'image/png' });
test('file transfers select actual images without claiming plain text, HTML or Markdown documents', () => {
  const image = png(), markdown = new File(['# note'], 'note.md', { type: 'text/markdown' });
  assert.deepEqual(imageFilesFromTransfer({ files: [markdown, image] }), [image]);
  assert.deepEqual(imageFilesFromTransfer({ files: [], items: [{ kind: 'string', type: 'text/html' }] }), []);
  assert.deepEqual(imageFilesFromTransfer({ files: [{ name: 'fake.png', type: 'image/png' }] }), []);
  assert.deepEqual(imageFilesFromTransfer({ items: [{ kind: 'file', getAsFile: () => image }] }), [image]);
});
test('image payloads retain byte order and distinguish unsupported and over-limit transfers', async () => {
  assert.deepEqual(await readImagePayloads([png()]), [{ name: '截图.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }]);
  await assert.rejects(readImagePayloads(Array.from({ length: 11 }, png)), /10/);
  await assert.rejects(readImagePayloads([new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })]), /PNG/);
  await assert.rejects(readImagePayloads([new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]), /20/);
  const large = new File([new Uint8Array(17 * 1024 * 1024)], 'part.png', { type: 'image/png' });
  await assert.rejects(readImagePayloads([large, large, large]), /50/);
});
test('source image markup escapes alt and destination without emitting embedded HTML', () => {
  assert.equal(imageMarkdown([{ src: 'note.assets/a b.png', alt: 'a[b]\\c' }, { src: 'two.png', alt: '' }]), '![a\\[b\\]\\\\c](note.assets/a%20b.png)\n\n![](two.png)');
});
test('async image completion refuses a switched document and a mismatched response id', async () => {
  const target = { id: 'original' }; let active = true, complete, inserted = [];
  const pending = importAtTarget(target, { isCurrent: () => active,
    request: () => new Promise(resolve => { complete = resolve; }), insert: images => inserted.push(...images) });
  active = false; complete({ documentId: 'original', images: [{ src: 'a.png', alt: '' }] });
  await assert.rejects(pending, /文档/); assert.deepEqual(inserted, []);
  await assert.rejects(importAtTarget(target, { isCurrent: () => true,
    request: async () => ({ documentId: 'other', images: [{ src: 'a.png', alt: '' }] }), insert: images => inserted.push(...images) }), /文档/);
  assert.deepEqual(inserted, []);
});
test('async image completion inserts one batch and canceled imports leave the selection alone', async () => {
  const batches = [], target = { id: 'original' };
  assert.equal(await importAtTarget(target, { isCurrent: () => true,
    request: async () => ({ documentId: 'original', src: 'a.png', alt: 'legacy button' }), insert: images => batches.push(images) }), true);
  assert.deepEqual(batches, [[{ src: 'a.png', alt: 'legacy button' }]]);
  assert.equal(await importAtTarget(target, { isCurrent: () => true,
    request: async () => ({ canceled: true }), insert: images => batches.push(images) }), false);
  assert.equal(batches.length, 1);
});
test('draft images can preview without a saved path but malformed tokens cannot escape the image protocol', () => {
  const token = 'md-draft-image:01234567-89ab-4cde-8fab-0123456789ab.png';
  assert.equal(imageURLForDocument(token, { path: null, imageKey: 'key' }), 'moye-image://key/' + encodeURIComponent(token));
  for (const src of ['md-draft-image:../secret.png', token + '/../../file', 'javascript:alert(1)', 'file:///secret.png', '//server/file.png', 'plain.png']) {
    assert.equal(imageURLForDocument(src, { path: null, imageKey: 'key' }), '', src);
  }
  assert.equal(imageURLForDocument('images/photo.png', { path: 'note.md', imageKey: 'key' }), 'moye-image://key/images%2Fphoto.png');
});
