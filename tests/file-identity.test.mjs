import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { documentFileKey } from '../src/file-identity.mjs';

function virtualFs({ paths, directories }) {
  return {
    async realpath(value) {
      if (Object.hasOwn(paths, value)) return paths[value];
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    async readdir(value) {
      assert.ok(Object.hasOwn(directories, value), `Unexpected directory: ${value}`);
      return directories[value];
    },
  };
}

test('Mac file keys preserve separate case-sensitive documents', async () => {
  assert.equal(typeof documentFileKey, 'function');
  const fsApi = virtualFs({ paths: { '/Notes/A.md': '/Notes/A.md', '/Notes/a.md': '/Notes/a.md' }, directories: { '/': ['Notes'], '/Notes': ['A.md', 'a.md'] } });
  const options = { platform: 'darwin', pathApi: path.posix, fsApi };
  assert.equal(await documentFileKey('/Notes/A.md', options), '/Notes/A.md');
  assert.equal(await documentFileKey('/Notes/a.md', options), '/Notes/a.md');
});

test('Mac file keys collapse case aliases using the actual directory spelling', async () => {
  assert.equal(typeof documentFileKey, 'function');
  const fsApi = virtualFs({ paths: { '/notes/a.md': '/notes/a.md', '/Notes/A.md': '/Notes/A.md' }, directories: { '/': ['Notes'], '/Notes': ['A.md'] } });
  const options = { platform: 'darwin', pathApi: path.posix, fsApi };
  assert.equal(await documentFileKey('/notes/a.md', options), '/Notes/A.md');
  assert.equal(await documentFileKey('/Notes/A.md', options), '/Notes/A.md');
});

test('Mac file keys resolve symlink parents while preserving a new filename', async () => {
  assert.equal(typeof documentFileKey, 'function');
  const fsApi = virtualFs({ paths: { '/shortcut': '/Notes' }, directories: { '/': ['Notes'] } });
  assert.equal(await documentFileKey('/shortcut/New.md', { platform: 'darwin', pathApi: path.posix, fsApi }), '/Notes/New.md');
});

test('Windows file keys preserve legacy lower-case canonical paths and missing-folder fallback', async () => {
  assert.equal(typeof documentFileKey, 'function');
  const fsApi = virtualFs({ paths: { 'C:\\Link\\Plan.md': 'C:\\Notes\\Plan.md' }, directories: {} });
  const options = { platform: 'win32', pathApi: path.win32, fsApi };
  assert.equal(await documentFileKey('C:\\Link\\Plan.md', options), 'c:\\notes\\plan.md');
  assert.equal(await documentFileKey('C:\\Missing\\New.md', options), 'c:\\missing\\new.md');
});

test('file keys propagate parent permission and IO errors for a missing document', async () => {
  for (const platform of ['win32', 'darwin']) {
    for (const code of ['EACCES', 'EIO']) {
      const fsApi = { async realpath(value) {
        throw Object.assign(new Error(code), { code: value.endsWith('New.md') ? 'ENOENT' : code });
      } };
      await assert.rejects(documentFileKey('/Missing/New.md', { platform, pathApi: path.posix, fsApi }), { code });
    }
  }
});

test('Mac file keys keep realpath spelling when the user cannot enumerate a parent directory', async () => {
  for (const code of ['EACCES', 'EPERM']) {
    const fsApi = {
      async realpath(value) { return value === '/Link/A.md' ? '/Private/A.md' : '/Private/a.md'; },
      async readdir() { throw Object.assign(new Error(code), { code }); },
    };
    const options = { platform: 'darwin', pathApi: path.posix, fsApi };
    assert.equal(await documentFileKey('/Link/A.md', options), '/Private/A.md');
    assert.equal(await documentFileKey('/Link/a.md', options), '/Private/a.md');
  }
});

test('document file keys survive atomic saves and resolve dot path aliases', async t => {
  assert.equal(typeof documentFileKey, 'function');
  const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-identity-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const actual = path.join(dir, 'actual');
  await fs.mkdir(actual);
  const filename = path.join(actual, 'Plan.md');
  await fs.writeFile(filename, 'before');
  const key = await documentFileKey(filename);
  assert.equal(await documentFileKey(`${actual}${path.sep}..${path.sep}actual${path.sep}Plan.md`), key);
  const { readDocument, writeDocument } = await import('../src/files.mjs');
  const document = await readDocument(filename);
  await writeDocument(filename, 'after', document.fingerprint);
  assert.equal(await documentFileKey(filename), key);
});
