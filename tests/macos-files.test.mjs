import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readDocument, renameDocument } from '../src/files.mjs';
import { documentFileKey, findDocumentAliases } from '../src/file-identity.mjs';

const nativeTest = process.platform === 'darwin' ? test : test.skip;
const run = promisify(execFile);
const helperPath = process.env.MD_TEST_RENAME_HELPER || fileURLToPath(new URL('../build/macos/md-rename', import.meta.url));
const rename = (source, name, fingerprint) => renameDocument(source, name, fingerprint, 'md', { helperPath });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(process.env.MD_TEST_FILE_ROOT || process.cwd(), '.test-macos-files-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, '中文文档.md');
  await fs.writeFile(source, '\ufeff# 原文\r\n中文正文。\r\n');
  return { directory, source, document: await readDocument(source) };
}

nativeTest('native Mac rename preserves Unicode contents, handles no-op and case-only names', async t => {
  const { directory, source, document } = await fixture(t);
  assert.equal(await rename(source, '中文文档.md', document.fingerprint), source);
  const first = await rename(source, '计划Plan.md', document.fingerprint);
  const second = await rename(first, '计划PLAN.md', document.fingerprint);
  assert.equal(await fs.readFile(second, 'utf8'), document.content);
  assert.deepEqual(await fs.readdir(directory), ['计划PLAN.md']);
});

nativeTest('native Mac exclusive rename rejects files, directories, symlinks and hardlinks', async t => {
  const { directory, source, document } = await fixture(t);
  await fs.writeFile(path.join(directory, 'existing.md'), 'preserve');
  await fs.mkdir(path.join(directory, 'directory.md'));
  await fs.symlink('missing.md', path.join(directory, 'symlink.md'));
  await fs.link(source, path.join(directory, 'hardlink.md'));
  for (const name of ['existing.md', 'directory.md', 'symlink.md', 'hardlink.md']) {
    await assert.rejects(rename(source, name, document.fingerprint), /已存在/);
    assert.equal(await fs.readFile(source, 'utf8'), document.content);
  }
  assert.equal(await fs.readFile(path.join(directory, 'existing.md'), 'utf8'), 'preserve');
  assert.equal(await fs.readlink(path.join(directory, 'symlink.md')), 'missing.md');
  assert.equal((await fs.readdir(directory)).length, 5);
});

nativeTest('native helper independently rejects external edits and a missing source', async t => {
  const { directory, source, document } = await fixture(t);
  const target = path.join(directory, 'new.md');
  await fs.writeFile(source, 'external change');
  await assert.rejects(run(helperPath, [source, target, document.fingerprint]), error => error.stderr.trim() === 'ECHANGED');
  assert.equal(await fs.readFile(source, 'utf8'), 'external change');
  await fs.rm(source);
  await assert.rejects(run(helperPath, [source, target, document.fingerprint]), error => error.stderr.trim() === 'ENOENT');
  assert.deepEqual(await fs.readdir(directory), []);
});

nativeTest('native helper atomically arbitrates competing renames without losing either document', async t => {
  const { directory, source, document } = await fixture(t);
  const other = path.join(directory, 'other.md');
  await fs.writeFile(other, 'second document');
  const second = await readDocument(other);
  const target = path.join(directory, 'winner.md');
  const results = await Promise.allSettled([
    run(helperPath, [source, target, document.fingerprint]),
    run(helperPath, [other, target, second.fingerprint]),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.stderr.trim(), 'EEXIST');
  const entries = await fs.readdir(directory);
  assert.equal(entries.length, 2);
  const contents = await Promise.all(entries.map(name => fs.readFile(path.join(directory, name), 'utf8')));
  assert.deepEqual(contents.sort(), [document.content, second.content].sort());
});

nativeTest('native helper refuses invalid requests without changing a file', async t => {
  const { directory, source, document } = await fixture(t);
  for (const args of [[], [source, path.join(directory, 'new.md')], [source, path.join(directory, 'new.md'), 'invalid'], [source, path.join(directory, 'sub', 'new.md'), document.fingerprint]]) {
    await assert.rejects(run(helperPath, args), error => error.stderr.trim() === 'EINVAL');
  }
  assert.deepEqual(await fs.readdir(directory), ['中文文档.md']);
});

nativeTest('Mac native file keys unify symlinks and case aliases but keep case-sensitive files distinct', async t => {
  const { directory } = await fixture(t);
  const upper = path.join(directory, 'Plan.md');
  const lower = path.join(directory, 'plan.md');
  await fs.writeFile(upper, 'upper');
  const alias = path.join(directory, 'alias.md');
  await fs.symlink(upper, alias);
  assert.equal(await documentFileKey(alias), await documentFileKey(upper));
  assert.deepEqual(await findDocumentAliases(upper, [alias]), [alias]);
  try {
    await fs.writeFile(lower, 'lower', { flag: 'wx' });
    assert.notEqual(await documentFileKey(upper), await documentFileKey(lower));
    assert.deepEqual(await findDocumentAliases(upper, [lower, alias]), [alias]);
    const document = await readDocument(upper);
    await assert.rejects(rename(upper, 'plan.md', document.fingerprint), /已存在/);
    assert.equal(await fs.readFile(lower, 'utf8'), 'lower');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.notEqual(process.env.MD_TEST_CASE_SENSITIVE, '1', 'The explicit case-sensitive run requires a case-sensitive volume');
    assert.equal(await documentFileKey(lower), await documentFileKey(upper));
    assert.deepEqual(await findDocumentAliases(upper, [lower, alias]), [lower, alias]);
  }
});
