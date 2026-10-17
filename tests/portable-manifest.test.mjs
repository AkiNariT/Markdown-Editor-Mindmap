import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectRuntimeFiles, runtimeFileChecks, runtimeHashChecks } from '../scripts/portable-manifest.mjs';

test('runtime checks include nested and empty files with byte lengths and literal filenames', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'md-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'resources', 'app'), { recursive: true });
  await writeFile(path.join(root, 'MD.exe'), 'runtime');
  await writeFile(path.join(root, 'empty'), '');
  await writeFile(path.join(root, 'resources', 'app', '$内容.txt'), '中文');
  const files = await collectRuntimeFiles(root);
  assert.deepEqual(files, [
    { relative: 'MD.exe', size: 7 },
    { relative: 'empty', size: 0 },
    { relative: 'resources/app/$内容.txt', size: 6 },
  ]);
  // This is generated compiler input: a literal dollar must not expand as an
  // NSIS variable or its size check will target a different cached file.
  assert.match(runtimeFileChecks(files), /MDCheckRuntimeFile "resources\\app\\\$\$内容\.txt" 6/);
});

test('a package cannot silently follow a junction outside its runtime directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'md-manifest-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'package'));
  await mkdir(path.join(root, 'outside'));
  await writeFile(path.join(root, 'outside', 'private.txt'), 'not part of the package');
  await symlink(path.join(root, 'outside'), path.join(root, 'package', 'linked'), 'junction');
  await assert.rejects(collectRuntimeFiles(path.join(root, 'package')), /symbolic link|junction/i);
});

test('compiler checks reject empty manifests, unsafe paths, and unsupported file lengths', () => {
  assert.throws(() => runtimeFileChecks([]), /empty/i);
  for (const relative of ['../MD.exe', 'nested/../MD.exe', '/MD.exe', 'C:/MD.exe', 'bad\nname', 'bad"name', 'file:stream']) {
    assert.throws(() => runtimeFileChecks([{ relative, size: 1 }]), /path/i, relative);
  }
  for (const size of [-1, 1.5, 2147483648, NaN]) {
    assert.throws(() => runtimeFileChecks([{ relative: 'MD.exe', size }]), /size/i);
  }
});

test('cold-cache hashes distinguish same-length corruption independently of file sizes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'md-manifest-hash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'MD.exe'), 'abc');
  const original = await collectRuntimeFiles(root, { hashes: true });
  assert.equal(original[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await writeFile(path.join(root, 'MD.exe'), 'xyz');
  const changed = await collectRuntimeFiles(root, { hashes: true });
  assert.equal(changed[0].size, original[0].size);
  assert.notEqual(changed[0].sha256, original[0].sha256);
  assert.match(runtimeHashChecks(original), /MDCheckRuntimeHash "MD\.exe" 3 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"/);
  assert.throws(() => runtimeHashChecks([{ relative: 'MD.exe', size: 3 }]), /SHA-256/);
});
