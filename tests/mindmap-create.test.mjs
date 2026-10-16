import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import { setLocale } from '../src/i18n.mjs';
import { suggestNodeFileName, nodeMarkdown, createNodeMarkdown } from '../src/mindmap-create.mjs';
import * as markdownCreation from '../src/mindmap-create.mjs';
async function fixture(t) {
  const directory = await mkdtemp(join(process.cwd(), '.mindmap-create-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('first save of a node draft writes edited Markdown verbatim and cannot replace another file', async t => {
  assert.equal(typeof markdownCreation.writeNewMarkdown, 'function');
  const directory = await fixture(t), target = join(directory, 'draft.md');
  const content = '\ufeff# Edited title\r\n\r\nWritten before choosing a location.\r\n';
  const result = await markdownCreation.writeNewMarkdown(target, content);
  assert.equal(result.content, content); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(target, 'utf8'), content);
  await assert.rejects(markdownCreation.writeNewMarkdown(target, 'must not overwrite'), error => error.code === 'EEXIST');
  assert.equal(await readFile(target, 'utf8'), content);
  assert.deepEqual(await readdir(directory), ['draft.md']);
});
function mockFilesystem(t, name, implementation) {
  const fs = createRequire(import.meta.url)('node:fs/promises');
  const original = fs[name];
  const mocked = t.mock.method(fs, name, implementation(original));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}

test('node names produce safe Windows filenames while preserving readable Unicode', () => {
  for (const [input, expected] of [
    ['  项目 / 计划: <第一阶段>?\r\n ', '项目 计划 第一阶段.md'],
    ['report.markdown', 'report.md'], ['CON', '_CON.md'], ['LPT1.txt', '_LPT1.txt.md'],
    ['\t... \n', '未命名.md'], ['资料\\笔记*草稿|备注', '资料 笔记 草稿 备注.md'],
  ]) assert.equal(suggestNodeFileName(input), expected);
  const long = suggestNodeFileName('😀'.repeat(300));
  assert.ok(long.length <= 255); assert.equal(long.endsWith('.md'), true);
  assert.equal(long.slice(0, -3).isWellFormed(), true);
  assert.equal(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/.test(long), false);
});

test('a node title becomes one literal H1 without Markdown or HTML side effects', () => {
  const title = '# Plan *A* [link](https://example.com) <img src=x> &copy; \\ path\r\n## Next\tstep';
  const dom = new JSDOM(marked.parse(nodeMarkdown(title)));
  assert.equal(dom.window.document.body.children.length, 1);
  assert.equal(dom.window.document.querySelector('h1').textContent, '# Plan *A* [link](https://example.com) <img src=x> &copy; \\ path ## Next step');
  assert.equal(dom.window.document.querySelectorAll('a,img,script,strong,em,h2').length, 0);
  assert.throws(() => nodeMarkdown(null));
});

test('empty node defaults follow the chosen language without changing nonempty titles', () => {
  setLocale('en');
  try {
    assert.equal(suggestNodeFileName(''), 'Untitled.md');
    assert.equal(nodeMarkdown(''), '# Untitled\n\n');
    assert.equal(nodeMarkdown('中文主题'), '# 中文主题\n\n');
  } finally { setLocale('zh-CN'); }
});

test('a new Markdown file is complete on return and no temporary file remains', async t => {
  const directory = await fixture(t), target = join(directory, '中文 note.md');
  assert.deepEqual(await createNodeMarkdown(target, 'My heading'), { path: target });
  assert.equal(await readFile(target, 'utf8'), '# My heading\n\n');
  assert.deepEqual(await readdir(directory), ['中文 note.md']);
});

test('existing files and directories cannot be replaced by node creation', async t => {
  const directory = await fixture(t), target = join(directory, 'existing.md'), folder = join(directory, 'folder.md');
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41, 0x0d, 0x0a]);
  await writeFile(target, bytes); await mkdir(folder);
  await assert.rejects(createNodeMarkdown(target, 'Replacement'), error => error.code === 'EEXIST' && /存在/.test(error.message));
  await assert.rejects(createNodeMarkdown(folder, 'Replacement'), error => error.code === 'EEXIST' && /存在/.test(error.message));
  assert.deepEqual(await readFile(target), bytes); assert.equal((await stat(folder)).isDirectory(), true);
  assert.deepEqual((await readdir(directory)).sort(), ['existing.md', 'folder.md']);
});

test('simultaneous creates have one winner and never overwrite its complete document', async t => {
  const directory = await fixture(t), target = join(directory, 'race.md');
  const result = await Promise.allSettled([createNodeMarkdown(target, 'First'), createNodeMarkdown(target, 'Second')]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(result.filter(value => value.status === 'rejected' && value.reason.code === 'EEXIST').length, 1);
  assert.ok(['# First\n\n', '# Second\n\n'].includes(await readFile(target, 'utf8')));
  assert.deepEqual(await readdir(directory), ['race.md']);
});

test('missing directories and invalid destinations do not create unrelated paths', async t => {
  const directory = await fixture(t);
  await assert.rejects(createNodeMarkdown(join(directory, 'missing', 'note.md'), 'Title'), { code: 'ENOENT' });
  await assert.rejects(createNodeMarkdown(join(directory, 'note.txt'), 'Title'));
  await assert.rejects(createNodeMarkdown(join(directory, 'NUL.md'), 'Title'));
  assert.deepEqual(await readdir(directory), []);
});

test('a sync failure leaves no partial document or temporary file', async t => {
  const directory = await fixture(t), target = join(directory, 'note.md');
  const probe = await open(join(directory, 'probe'), 'wx'), prototype = Object.getPrototypeOf(probe);
  await probe.close(); await rm(join(directory, 'probe'));
  t.mock.method(prototype, 'sync', async () => { throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' }); });
  await assert.rejects(createNodeMarkdown(target, 'Title'), { code: 'EIO' });
  assert.deepEqual(await readdir(directory), []);
});

test('a temporary-name collision preserves the file that was already there', async t => {
  const directory = await fixture(t), target = join(directory, 'note.md');
  const temporary = join(directory, '.md-node-collision.tmp');
  await writeFile(temporary, 'belongs to another writer');
  const crypto = createRequire(import.meta.url)('node:crypto');
  const mocked = t.mock.method(crypto, 'randomUUID', () => 'collision');
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(createNodeMarkdown(target, 'Title'), { code: 'EEXIST' });
  assert.equal(await readFile(temporary, 'utf8'), 'belongs to another writer');
  assert.deepEqual(await readdir(directory), ['.md-node-collision.tmp']);
});

test('unsupported hard links fall back to exclusive creation of a complete file', async t => {
  const directory = await fixture(t);
  let code;
  mockFilesystem(t, 'link', () => async () => { throw Object.assign(new Error('simulated unsupported hard link'), { code }); });
  const codes = ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', ...(process.platform === 'win32' ? ['EISDIR'] : [])];
  for (code of codes) {
    const target = join(directory, code + '.md');
    assert.deepEqual(await createNodeMarkdown(target, 'Fallback heading'), { path: target });
    assert.equal(await readFile(target, 'utf8'), '# Fallback heading\n\n');
  }
  assert.deepEqual((await readdir(directory)).sort(), codes.map(code => code + '.md').sort());
});

test('fallback creation preserves an existing file and resolves competing creates exclusively', async t => {
  const directory = await fixture(t), existing = join(directory, 'existing.md'), competing = join(directory, 'race.md');
  mockFilesystem(t, 'link', () => async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); });
  await writeFile(existing, 'existing bytes\r\n');
  await assert.rejects(createNodeMarkdown(existing, 'Replace'), error => error.code === 'EEXIST' && /存在/.test(error.message));
  assert.equal(await readFile(existing, 'utf8'), 'existing bytes\r\n');
  const result = await Promise.allSettled([createNodeMarkdown(competing, 'A'), createNodeMarkdown(competing, 'B')]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(result.filter(value => value.status === 'rejected' && value.reason.code === 'EEXIST').length, 1);
  assert.ok(['# A\n\n', '# B\n\n'].includes(await readFile(competing, 'utf8')));
  assert.deepEqual((await readdir(directory)).sort(), ['existing.md', 'race.md']);
});

test('permission and I/O link errors are not misclassified as unsupported filesystems', async t => {
  const directory = await fixture(t); let code;
  mockFilesystem(t, 'link', () => async () => { throw Object.assign(new Error('link failure'), { code }); });
  for (code of ['EPERM', 'EACCES', 'EIO', 'ENOSPC', 'EINVAL']) await assert.rejects(createNodeMarkdown(join(directory, code + '.md'), 'Title'), error => error.code === code);
  assert.deepEqual(await readdir(directory), []);
});

test('fallback write and sync failures clean up only the file created by this attempt', async t => {
  const directory = await fixture(t); let stage = 'write';
  mockFilesystem(t, 'link', () => async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); });
  mockFilesystem(t, 'open', original => async (target, ...args) => {
    const handle = await original(target, ...args);
    if (target === join(directory, stage + '.md')) {
      if (stage === 'write') {
        const originalWrite = handle.writeFile;
        t.mock.method(handle, 'writeFile', async function () { await originalWrite.call(this, 'partial', 'utf8'); throw Object.assign(new Error('write failed'), { code: 'EIO' }); });
      } else t.mock.method(handle, 'sync', async () => { throw Object.assign(new Error('sync failed'), { code: 'EIO' }); });
    }
    return handle;
  });
  for (stage of ['write', 'sync']) {
    await assert.rejects(createNodeMarkdown(join(directory, stage + '.md'), 'Title'), { code: 'EIO' });
    assert.deepEqual(await readdir(directory), []);
  }
});

test('fallback failure does not unlink a replacement created by another writer', async t => {
  const directory = await fixture(t), target = join(directory, 'note.md'), moved = join(directory, 'moved.md');
  mockFilesystem(t, 'link', () => async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); });
  mockFilesystem(t, 'open', original => async (file, ...args) => {
    const handle = await original(file, ...args);
    if (file === target) {
      const originalWrite = handle.writeFile;
      t.mock.method(handle, 'writeFile', async function () {
        await originalWrite.call(this, 'partial', 'utf8');
        await rename(target, moved); await writeFile(target, 'belongs to another writer');
        throw Object.assign(new Error('write failed after replacement'), { code: 'EIO' });
      });
    }
    return handle;
  });
  await assert.rejects(createNodeMarkdown(target, 'Title'), { code: 'EIO' });
  assert.equal(await readFile(target, 'utf8'), 'belongs to another writer');
  assert.deepEqual((await readdir(directory)).sort(), ['moved.md', 'note.md']);
});
