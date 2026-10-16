import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecoveryStore, normalizeSession, mergeCheckpoint, sanitizeViewState, sessionAfterDiscard } from '../src/recovery.mjs';

const baseline = { id: 'one', type: 'markdown', path: null, content: '# 原文\r\n', fingerprint: null, dirty: false };
const session = (documents = [baseline]) => ({ version: 1, activeId: documents[0]?.id ?? null, documents });
async function fixture(t) {
  const directory = await mkdtemp(join(process.cwd(), '.recovery-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createRecoveryStore(directory) };
}

test('a durable checkpoint preserves invalid source drafts separately from originals', async t => {
  const { directory, store } = await fixture(t);
  const original = join(directory, 'SKILL.md'); await writeFile(original, '# 原文\r\n');
  const state = session([{ ...baseline, path: original, fingerprint: 'a'.repeat(64), dirty: true, draft: '---\nname: [未完成\n' }]);
  const saved = await store.save(state);
  assert.equal(saved.ok, true); assert.equal(typeof saved.at, 'string');
  const loaded = await createRecoveryStore(directory).load();
  assert.equal(loaded.session.documents[0].draft, '---\nname: [未完成\n');
  assert.equal(loaded.session.documents[0].content, '# 原文\r\n');
  assert.equal(loaded.session.documents[0].fingerprint, 'a'.repeat(64));
  assert.equal(await readFile(original, 'utf8'), '# 原文\r\n');
  assert.deepEqual((await readdir(directory)).sort(), ['SKILL.md', 'session.json']);
});

test('pending mindmap links survive durable recovery independently of the target tab', async t => {
  const { store } = await fixture(t);
  const pendingMindmapLink = { mapId: 'map-tab', nodeId: 'topic', ignored: 'not persisted' };
  await store.save(session([{ ...baseline, namedDraft: true, pendingMindmapLink }]));
  pendingMindmapLink.nodeId = 'changed after saving';
  assert.deepEqual((await store.load()).session.documents[0].pendingMindmapLink, { mapId: 'map-tab', nodeId: 'topic' });
  const importedNodeId = 'n'.repeat(256);
  await store.save(session([{ ...baseline, pendingMindmapLink: { mapId: 'map-tab', nodeId: importedNodeId } }]));
  assert.equal((await store.load()).session.documents[0].pendingMindmapLink.nodeId, importedNodeId);
  assert.equal(normalizeSession(session()).documents[0].pendingMindmapLink, undefined);
});

test('malformed pending mindmap links cannot replace a durable draft', async t => {
  const { store } = await fixture(t);
  await store.save(session());
  for (const pendingMindmapLink of [null, [], 'topic', {}, { mapId: '', nodeId: 'topic' }, { mapId: 'map', nodeId: '' }, { mapId: 'map', nodeId: 1 }, { mapId: 'map', nodeId: 'bad\u0001id' }, { mapId: 'x'.repeat(129), nodeId: 'topic' }]) {
    await assert.rejects(store.save(session([{ ...baseline, pendingMindmapLink }])), /恢复/);
  }
  await assert.rejects(store.save(session([{ ...baseline, type: 'mindmap', pendingMindmapLink: { mapId: 'map', nodeId: 'topic' } }])), /恢复/);
  assert.equal((await store.load()).session.documents[0].content, '# 原文\r\n');
});

test('renderer checkpoints cannot forge, replace or clear main-owned pending links', () => {
  const pendingMindmapLink = { mapId: 'map-tab', nodeId: 'topic' };
  const records = new Map([['one', { ...baseline, pendingMindmapLink }], ['two', { ...baseline, id: 'two' }]]);
  mergeCheckpoint(records, { documents: [
    { id: 'one', draft: 'updated', dirty: true, pendingMindmapLink: { mapId: 'forged', nodeId: 'other' } },
    { id: 'two', draft: 'other draft', dirty: true, pendingMindmapLink },
  ] });
  assert.deepEqual(records.get('one').pendingMindmapLink, { mapId: 'map-tab', nodeId: 'topic' });
  assert.equal(records.get('two').pendingMindmapLink, undefined);
  mergeCheckpoint(records, { documents: [{ id: 'one', draft: 'updated again', dirty: true, pendingMindmapLink: null }] });
  assert.deepEqual(records.get('one').pendingMindmapLink, { mapId: 'map-tab', nodeId: 'topic' });
});

test('corrupt primary recovers the last valid backup and reports fallback', async t => {
  const { directory, store } = await fixture(t);
  await store.save(session([{ ...baseline, draft: 'first', dirty: true }]));
  await store.save(session([{ ...baseline, draft: 'second', dirty: true }]));
  await writeFile(join(directory, 'session.json'), '{broken');
  const recovered = await createRecoveryStore(directory).load();
  assert.equal(recovered.source, 'backup'); assert.match(recovered.notice, /备份/);
  assert.equal(recovered.session.documents[0].draft, 'first');
  await store.save(session([{ ...baseline, draft: 'third', dirty: true }]));
  await writeFile(join(directory, 'session.json'), '{broken again');
  assert.equal((await store.load()).session.documents[0].draft, 'first');
});

test('concurrent snapshots serialize invocation order and copy input immediately', async t => {
  const { directory, store } = await fixture(t);
  const snapshots = Array.from({ length: 12 }, (_, i) => session([{ ...baseline, draft: String(i), dirty: true }]));
  const saves = snapshots.map(value => store.save(value));
  snapshots[11].documents[0].draft = 'mutated after save';
  await Promise.all(saves);
  assert.equal((await store.load()).session.documents[0].draft, '11');
  assert.equal(JSON.parse(await readFile(join(directory, 'session.backup.json'), 'utf8')).documents[0].draft, '10');
  assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
});

test('failed disk writes do not poison later queued saves', async t => {
  const { directory } = await fixture(t), profile = join(directory, 'profile');
  await writeFile(profile, 'blocking file'); const store = createRecoveryStore(profile);
  await assert.rejects(store.save(session()));
  await rm(profile); await mkdir(profile);
  await store.save(session()); assert.equal((await store.load()).session.documents.length, 1);
});

test('malformed sessions and oversized drafts are rejected without replacing a good snapshot', async t => {
  const { store } = await fixture(t); await store.save(session());
  for (const value of [
    { ...session(), version: 999 },
    session([baseline, baseline]),
    session([{ ...baseline, content: null }]),
    session([{ ...baseline, draft: 'x'.repeat(8 * 1024 * 1024 + 1) }]),
    session(Array.from({ length: 81 }, (_, i) => ({ ...baseline, id: String(i) }))),
    session(Array.from({ length: 17 }, (_, i) => ({ ...baseline, id: String(i), content: 'x'.repeat(8 * 1024 * 1024) }))),
  ]) await assert.rejects(store.save(value), /恢复|备份|8 MB|128 MB|80/);
  assert.equal((await store.load()).session.documents[0].content, '# 原文\r\n');
});

test('missing profiles are empty and entirely corrupt profiles are reported without throwing', async t => {
  const { directory, store } = await fixture(t);
  assert.deepEqual(await store.load(), { session: null, notice: null, source: null });
  await writeFile(join(directory, 'session.json'), '{bad');
  const loaded = await store.load(); assert.equal(loaded.session, null); assert.match(loaded.notice, /恢复/);
});

test('checkpoint accepts known drafts and ignores renderer attempts to change saved baseline', () => {
  const records = new Map([['one', { ...baseline, draft: 'previous', dirty: true }], ['two', { ...baseline, id: 'two', draft: 'IME last good', dirty: true }]]);
  mergeCheckpoint(records, { documents: [{ id: 'one', draft: '---\ninvalid: [', dirty: true, content: 'forged baseline', path: 'C:/forged.md', visualLossy: true, viewState: { editing: true, view: 'source' } }] });
  assert.equal(records.get('one').content, '# 原文\r\n'); assert.equal(records.get('one').path, null);
  assert.equal(records.get('one').draft, '---\ninvalid: ['); assert.equal(records.get('one').copyOnly, true);
  assert.equal(records.get('two').draft, 'IME last good');
  assert.throws(() => mergeCheckpoint(records, { documents: [{ id: 'unknown', draft: '', dirty: false }] }), /标签|文档/);
});

test('checkpoint validation is atomic and rejects invalid mindmap drafts', () => {
  const records = new Map([['one', { ...baseline, draft: 'before' }], ['map', { ...baseline, id: 'map', type: 'mindmap', draft: 'before-map' }]]);
  assert.throws(() => mergeCheckpoint(records, { documents: [{ id: 'one', draft: 'after', dirty: true }, { id: 'map', draft: 'bad map', dirty: true }] }, { validateMap: () => { throw new Error('invalid map'); } }), /invalid map/);
  assert.equal(records.get('one').draft, 'before');
  assert.throws(() => mergeCheckpoint(records, { documents: [{ id: 'one', draft: 'after', dirty: 'false' }] }), /状态|文档/);
});

test('a checkpoint after saving cannot replace the newer authoritative baseline or fingerprint', () => {
  const records = new Map([['one', { ...baseline, content: '# 刚刚保存', fingerprint: 'b'.repeat(64), draft: '# 刚刚保存', dirty: false }]]);
  mergeCheckpoint(records, { documents: [{ id: 'one', content: '# 旧原文', fingerprint: 'a'.repeat(64), draft: '# 保存后的再次修改', dirty: true }] });
  assert.equal(records.get('one').content, '# 刚刚保存');
  assert.equal(records.get('one').fingerprint, 'b'.repeat(64));
  assert.equal(records.get('one').draft, '# 保存后的再次修改');
});

test('view state keeps only bounded display data', () => {
  assert.deepEqual(sanitizeViewState({ editing: true, view: 'compare', zoom: 999, outline: false, syncScroll: true, viewScroll: { render: -1, compare: Infinity }, sourceScroll: 2e9, sourceLeft: 12, map: { selected: 'node', position: { top: 150, left: 35 } }, html: '<script>' }), {
    editing: true, view: 'compare', zoom: 200, outline: false, syncScroll: true, viewScroll: { render: 0, compare: 0 }, sourceScroll: 1e8, sourceLeft: 12, map: { selected: 'node', position: { top: 150, left: 35 } },
  });
  const normalized = normalizeSession({ ...session(), activeId: 'unknown' });
  assert.equal(normalized.activeId, 'one');
});

test('0.1.18 sessions migrate drafts and reading positions while dropping the retired library', async t => {
  const { directory, store } = await fixture(t);
  const oldSession = { ...session([{ ...baseline, dirty: true, draft: '# 尚未保存', viewState: { view: 'compare', zoom: 125, viewScroll: { render: 412, compare: 98 } } }]), library: { root: directory, recents: [join(directory, '旧文档.md')] }, libraryVisible: true };
  await writeFile(join(directory, 'session.json'), JSON.stringify(oldSession));
  const loaded = await store.load();
  assert.equal(loaded.session.documents[0].draft, '# 尚未保存');
  assert.equal(loaded.session.documents[0].content, '# 原文\r\n');
  assert.equal(loaded.session.documents[0].viewState.viewScroll.render, 412);
  assert.equal(loaded.session.documents[0].viewState.zoom, 125);
  assert.equal('library' in loaded.session, false);
  assert.equal('libraryVisible' in loaded.session, false);
  await store.save(loaded.session);
  const stored = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
  assert.equal('library' in stored, false);
  assert.equal('libraryVisible' in stored, false);
});

test('an inferred SKILL document remains eligible for filename detection after normalization', () => {
  const normalized = normalizeSession(session([{ ...baseline, path: join(process.cwd(), 'SKILL.md') }]));
  assert.equal(normalized.documents[0].skillDocument, undefined);
  const explicit = normalizeSession(session([{ ...baseline, skillDocument: true }]));
  assert.equal(explicit.documents[0].skillDocument, true);
});

test('map layout padding survives recovery only when both coordinates are finite and in bounds', () => {
  const valid = sanitizeViewState({ map: { selected: 'node', position: { left: 70, top: 80 }, layoutPadding: { x: 320.5, y: 1e6 } } });
  assert.deepEqual(valid.map.layoutPadding, { x: 320.5, y: 1e6 });
  const persisted = normalizeSession(session([{ ...baseline, viewState: valid }]));
  assert.deepEqual(persisted.documents[0].viewState.map.layoutPadding, { x: 320.5, y: 1e6 });
  for (const padding of [null, [], { x: -1, y: 0 }, { x: 0, y: 1e6 + 1 }, { x: Infinity, y: 0 }, { x: 0, y: NaN }, { x: '0', y: 0 }, { x: 0 }]) {
    const sanitized = sanitizeViewState({ map: { selected: 'node', layoutPadding: padding } });
    assert.equal(sanitized.map.layoutPadding, undefined);
    assert.equal(sanitized.map.selected, 'node');
  }
});

test('discard snapshots drop pathless drafts and reset file drafts without mutating the live session', async t => {
  const { directory, store } = await fixture(t);
  const original = session([{ ...baseline, path: join(directory, 'one.md'), draft: 'discarded file change', dirty: true }, { ...baseline, id: 'two', draft: 'discarded scratch', dirty: true }]);
  original.activeId = 'two';
  await store.save(original);
  const discarded = sessionAfterDiscard(original, new Set(['one', 'two']));
  assert.equal(discarded.activeId, 'one'); assert.equal(discarded.documents.length, 1);
  assert.equal(discarded.documents[0].draft, undefined); assert.equal(discarded.documents[0].dirty, false);
  assert.equal(original.documents[0].draft, 'discarded file change'); assert.equal(original.documents.length, 2);
  await store.save(discarded); await store.save(discarded);
  await writeFile(join(directory, 'session.json'), '{broken');
  const fallback = await store.load(); assert.equal(fallback.session.documents.length, 1);
  assert.equal(fallback.session.documents[0].draft, undefined);
});
