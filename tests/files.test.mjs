import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readDocument, writeDocument } from '../src/files.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(process.cwd(), '.test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, '中文.md') };
}
test('read returns original Chinese text including BOM and CRLF', async t => {
  const { path } = await fixture(t);
  await writeFile(path, '\ufeff# 中文\r\n\r\n正文。\r\n');
  const doc = await readDocument(path);
  assert.equal(doc.content, '\ufeff# 中文\r\n\r\n正文。\r\n');
  assert.match(doc.fingerprint, /^[a-f0-9]{64}$/);
});
test('invalid UTF-8 is rejected instead of silently destroying bytes', async t => {
  const { path } = await fixture(t); await writeFile(path, Buffer.from([0xff, 0xfe, 0x80]));
  await assert.rejects(readDocument(path), /UTF-8/);
});
test('save replaces content atomically and leaves no scratch files', async t => {
  const { path, dir } = await fixture(t); await writeFile(path, '# 原文\n');
  const before = await readDocument(path);
  const saved = await writeDocument(path, '# 已修改\n', before.fingerprint);
  assert.equal(await readFile(path, 'utf8'), '# 已修改\n');
  assert.equal(saved.content, '# 已修改\n');
  assert.deepEqual(await readdir(dir), ['中文.md']);
});
test('external edit is preserved when save would overwrite it', async t => {
  const { path } = await fixture(t); await writeFile(path, '# 原文\n');
  const before = await readDocument(path); await writeFile(path, '# 外部修改\n');
  await assert.rejects(writeDocument(path, '# 我的修改\n', before.fingerprint), /外部/);
  assert.equal(await readFile(path, 'utf8'), '# 外部修改\n');
});
test('new-file save does not overwrite an unexpectedly created target', async t => {
  const { path } = await fixture(t); await writeFile(path, '外部创建');
  await assert.rejects(writeDocument(path, '我的正文', null), /外部/);
  assert.equal(await readFile(path, 'utf8'), '外部创建');
});
test('saving to missing folder fails without creating a ghost document', async t => {
  const { dir } = await fixture(t);
  await assert.rejects(writeDocument(join(dir, '不存在', '文档.md'), 'text', null));
  assert.deepEqual(await readdir(dir), []);
});
