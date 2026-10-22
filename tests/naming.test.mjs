import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import * as files from '../src/files.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(process.cwd(), '.test-naming-'));
  assert.equal(dirname(resolve(dir)), process.cwd());
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '原文件.md'); await writeFile(file, '\ufeff# 原文件\r\n\r\n原始内容。\r\n');
  return { dir, document: await files.readDocument(file) };
}
test('naming adds Markdown extension and rejects unsafe Windows file names', () => {
  assert.equal(typeof files.normalizeDocumentName, 'function', '提供保存前命名的文件名校验');
  for (const [input, expected] of [['工作记录', '工作记录.md'], ['  工作记录  ', '工作记录.md'], ['原文.MD', '原文.MD'], ['原文.markdown', '原文.markdown'], ['版本1.2', '版本1.2.md']]) assert.equal(files.normalizeDocumentName(input), expected);
  for (const name of ['', '  ', '.', '..', '.md', '../外部', '子目录/文件', 'a\\b', 'a:b', 'a*', 'a?', 'a"b', 'a<b', 'a>b', 'a|b', 'a\n', '名称.', 'NUL.md', 'CON', 'aux.markdown', 'COM1', 'COM¹.md', 'LPT².markdown', 'a'.repeat(253)]) assert.throws(() => files.normalizeDocumentName(name), undefined, name);
});
test('rename changes only the name and keeps original bytes', async t => {
  const { dir, document } = await fixture(t);
  assert.equal(typeof files.renameDocument, 'function');
  const target = await files.renameDocument(document.path, '中文新名', document.fingerprint);
  assert.equal(target, join(dir, '中文新名.md'));
  assert.equal(await readFile(target, 'utf8'), document.content);
  assert.deepEqual(await readdir(dir), ['中文新名.md']);
});
test('rename refuses an existing target file or directory without touching either', async t => {
  const { dir, document } = await fixture(t);
  await writeFile(join(dir, '已有.md'), '不可覆盖'); await mkdir(join(dir, '目录.md'));
  for (const name of ['已有.md', '目录.md']) await assert.rejects(files.renameDocument(document.path, name, document.fingerprint), /已存在/);
  assert.equal(await readFile(join(dir, '已有.md'), 'utf8'), '不可覆盖');
  assert.equal(await readFile(document.path, 'utf8'), document.content);
});
test('rename rejects external edits and deleted source files', async t => {
  const { dir, document } = await fixture(t);
  await writeFile(document.path, '外部新内容');
  await assert.rejects(files.renameDocument(document.path, '新名', document.fingerprint), /外部/);
  assert.equal(await readFile(document.path, 'utf8'), '外部新内容');
  await rm(document.path);
  await assert.rejects(files.renameDocument(document.path, '新名', document.fingerprint));
  assert.deepEqual(await readdir(dir), []);
});
test('case-only rename updates the on-disk spelling without replacing another file', async t => {
  const { dir, document } = await fixture(t);
  let target = await files.renameDocument(document.path, 'notes.md', document.fingerprint);
  target = await files.renameDocument(target, 'NOTES.md', document.fingerprint);
  assert.equal(target, join(dir, 'NOTES.md'));
  assert.deepEqual(await readdir(dir), ['NOTES.md']);
  assert.equal(await readFile(target, 'utf8'), document.content);
});

test('Mac rename reports an exclusive native-operation failure and preserves source bytes', async t => {
  const { dir, document } = await fixture(t);
  const calls = [];
  const execFileImpl = (executable, args, options, callback) => {
    calls.push({ executable, args });
    queueMicrotask(() => callback(new Error('native failure'), '', 'ENOTSUP'));
  };
  await assert.rejects(files.renameDocument(document.path, '中文新名', document.fingerprint, 'md', {
    platform: 'darwin', execFileImpl, helperPath: '/Applications/MD.app/Contents/Resources/md-rename',
  }), /不支持安全重命名/);
  assert.deepEqual(calls, [{ executable: '/Applications/MD.app/Contents/Resources/md-rename', args: [document.path, join(dir, '中文新名.md'), document.fingerprint] }]);
  assert.equal(await readFile(document.path, 'utf8'), document.content);
  assert.deepEqual(await readdir(dir), ['原文件.md']);
});

test('Mac rename translates a late destination conflict without retrying an overwriting move', async t => {
  const { dir, document } = await fixture(t);
  const destination = join(dir, '冲突.md');
  let calls = 0;
  const execFileImpl = (executable, args, options, callback) => {
    calls++;
    writeFile(destination, '外部创建').then(() => callback(new Error('native conflict'), '', 'EEXIST'));
  };
  await assert.rejects(files.renameDocument(document.path, '冲突', document.fingerprint, 'md', { platform: 'darwin', execFileImpl }), /已存在/);
  assert.equal(calls, 1);
  assert.equal(await readFile(destination, 'utf8'), '外部创建');
  assert.equal(await readFile(document.path, 'utf8'), document.content);
});
