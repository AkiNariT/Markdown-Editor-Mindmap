import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setLocale } from '../src/i18n.mjs';
import { normalizeDocumentName, readDocument, writeDocument } from '../src/files.mjs';
import { detectUnsupported } from '../src/document.mjs';
import { validateSkillFields } from '../src/frontmatter.mjs';
import { rebaseImages } from '../src/images.mjs';
import { createRecoveryStore, normalizeSession } from '../src/recovery.mjs';

async function fixture(t) {
  setLocale('en'); t.after(() => setLocale('zh-CN'));
  const directory = await mkdtemp(join(process.cwd(), '.backend-locale-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('English validation errors still enforce file, skill, image and recovery constraints', async t => {
  const directory = await fixture(t);
  assert.throws(() => normalizeDocumentName('CON.md'), /reserved/i);
  assert.throws(() => validateSkillFields({ name: 'Bad Name', description: 'Read files.' }), /lowercase/i);
  assert.throws(() => rebaseImages('![image](bad%ZZ.png)', directory, join(directory, 'next')), /image.*path/i);
  assert.throws(() => normalizeSession({ version: 1, documents: [{ id: 'one', content: null }] }), /recovery/i);
  assert.deepEqual(detectUnsupported('<div>raw</div>\n\n$math$'), ['HTML content or comments', 'Math formulas']);
  setLocale('zh-CN');
  assert.throws(() => normalizeDocumentName('CON.md'), /保留名称/);
});

test('English conflict errors preserve original file bytes', async t => {
  const directory = await fixture(t), file = join(directory, '原文.md');
  await writeFile(file, '# 原文\r\n'); const original = await readDocument(file);
  await writeFile(file, '# 外部修改\r\n');
  await assert.rejects(writeDocument(file, 'draft', original.fingerprint), /modified or deleted/i);
  assert.equal(await readFile(file, 'utf8'), '# 外部修改\r\n');
});

test('English recovery notices and corrupt-primary replacement keep drafts intact', async t => {
  const directory = await fixture(t), store = createRecoveryStore(directory);
  const session = draft => ({ version: 1, documents: [{ id: 'one', content: '# 基线\r\n', draft, dirty: true }] });
  await store.save(session('first')); await store.save(session('second'));
  await writeFile(join(directory, 'session.json'), '{"version":1,"documents":[{"id":"one","content":null}]}');
  const restored = await store.load();
  assert.match(restored.notice, /backup/i); assert.equal(restored.session.documents[0].draft, 'first');
  await store.save(session('---\nname: [未完成'));
  const latest = await store.load();
  assert.equal(latest.session.documents[0].draft, '---\nname: [未完成');
  assert.equal(latest.session.documents[0].content, '# 基线\r\n');
});
