import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createSettingsStore } from '../src/settings.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(process.cwd(), '.settings-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createSettingsStore(directory) };
}

test('missing or unusable settings start in Chinese without touching recovery data', async t => {
  const { directory, store } = await fixture(t);
  const recovery = '{"draft":"中文与 English 草稿"}';
  await writeFile(join(directory, 'session.json'), recovery);
  assert.deepEqual(await store.load(), { language: 'zh-CN' });
  for (const text of ['{broken', '{"language":"fr"}', '{"language":null}', '{"language":"en","version":99}', 'x'.repeat(65537)]) {
    await writeFile(join(directory, 'settings.json'), text);
    assert.deepEqual(await store.load(), { language: 'zh-CN' });
  }
  assert.equal(await readFile(join(directory, 'session.json'), 'utf8'), recovery);
});

test('language changes persist in order and survive creating a new store', async t => {
  const { directory, store } = await fixture(t);
  const writes = ['en', 'zh-CN', 'en'].map(language => store.setLanguage(language));
  assert.deepEqual(await Promise.all(writes), [{ language: 'en' }, { language: 'zh-CN' }, { language: 'en' }]);
  assert.deepEqual(await createSettingsStore(directory).load(), { language: 'en' });
  assert.deepEqual(await readdir(directory), ['settings.json']);
});

test('invalid language changes reject without replacing the previous settings', async t => {
  const { directory, store } = await fixture(t);
  await store.setLanguage('en');
  const before = await readFile(join(directory, 'settings.json'), 'utf8');
  for (const invalid of ['EN', 'zh', 'zh-cn', '', 'fr', null, {}, ['en']]) await assert.rejects(store.setLanguage(invalid));
  assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), before);
  assert.deepEqual(await store.load(), { language: 'en' });
});

test('profile language changes stay isolated and failed writes do not poison retries', async t => {
  const { directory, store } = await fixture(t);
  await store.setLanguage('en');
  const otherPath = join(directory, 'other');
  const other = createSettingsStore(otherPath);
  assert.deepEqual(await other.load(), { language: 'zh-CN' });
  await writeFile(otherPath, 'not a directory');
  await assert.rejects(other.setLanguage('en'));
  assert.deepEqual(await store.load(), { language: 'en' });
  await rm(otherPath); await mkdir(otherPath);
  await other.setLanguage('zh-CN');
  assert.deepEqual(await other.load(), { language: 'zh-CN' });
  assert.deepEqual(await store.load(), { language: 'en' });
});
