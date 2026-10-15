import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import * as files from '../src/files.mjs';

const node = (id, parent, extra = {}) => ({ id, parent, text: id, file: null, collapsed: false, ...extra });
const map = (nodes = [node('root', null)]) => ({ format: 'md-mindmap', version: 1, root: 'root', nodes });
const model = () => import('../src/mindmap.mjs');
const paths = () => import('../src/mindmap-files.mjs');

test('new mindmap is an independent editable tree that survives JSON serialization', async () => {
  const { createMindmap, parseMindmap, serializeMindmap } = await model();
  const first = createMindmap(), second = createMindmap();
  assert.equal(first.nodes.length, 1);
  assert.equal(first.nodes[0].id, first.root);
  assert.equal(first.nodes[0].parent, null);
  assert.equal(first.nodes[0].text, '中心主题');
  first.nodes[0].text = '项目计划';
  assert.equal(second.nodes[0].text, '中心主题');
  assert.deepEqual(parseMindmap(serializeMindmap(first)), first);
  assert.match(serializeMindmap(first), /\n$/);
});

test('validation preserves manual order and returns normalized isolated data', async () => {
  const { validateMindmap, parseMindmap } = await model();
  const input = map([node('b', 'root', { text: 'B', file: '../notes/B.MD', collapsed: true, extra: 1 }), node('root', null), node('a', 'root')]);
  const result = validateMindmap(input);
  assert.deepEqual(result.nodes.map(item => item.id), ['b', 'root', 'a']);
  assert.equal(result.nodes[0].file, '../notes/B.MD');
  assert.equal(result.nodes[0].collapsed, true);
  assert.equal(result.nodes[0].extra, undefined);
  result.nodes[0].text = '修改';
  assert.equal(input.nodes[0].text, 'B');
  assert.deepEqual(parseMindmap('\ufeff' + JSON.stringify(map())), map());
  assert.throws(() => parseMindmap('{'), /JSON|格式/);
  assert.throws(() => validateMindmap(JSON.stringify(map())));
});

test('moved node offsets survive disk serialization and do not share mutable state', async () => {
  const { validateMindmap, serializeMindmap, parseMindmap } = await model();
  const input = { ...map([node('root', null), node('a', 'root', { offset: { x: -120.5, y: 75 } })]), version: 2, connections: [] };
  const result = validateMindmap(input);
  assert.deepEqual(result.nodes[1].offset, { x: -120.5, y: 75 });
  result.nodes[1].offset.x = 900;
  assert.equal(input.nodes[1].offset.x, -120.5);
  assert.deepEqual(parseMindmap(serializeMindmap(input)), input);
  assert.deepEqual(validateMindmap(map()), map(), 'unmoved v1 maps remain v1 without added metadata');
});

test('invalid offsets and unversioned layout data are rejected rather than silently discarded', async () => {
  const { validateMindmap } = await model();
  for (const offset of [null, [], {}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 100001, y: 0 }, { x: 0, y: '1' }]) {
    assert.throws(() => validateMindmap({ ...map([node('root', null, { offset })]), version: 2, connections: [] }));
  }
  assert.throws(() => validateMindmap(map([node('root', null, { offset: { x: 1, y: 1 } })])));
});

test('saved and rebased mindmaps retain manual layout along with their Markdown links', async () => {
  const { serializeMindmapForPath, resolveMindmapFiles } = await paths();
  const { parseMindmap } = await model();
  const input = { ...map([node('root', null), node('a', 'root', { file: 'C:\\notes\\linked.md', offset: { x: 80, y: -50 } })]), version: 2, connections: [] };
  const stored = serializeMindmapForPath(input, 'C:\\maps\\work.mdmap', path.win32);
  const parsed = parseMindmap(stored);
  assert.equal(parsed.nodes[1].file, '../notes/linked.md');
  assert.deepEqual(parsed.nodes[1].offset, { x: 80, y: -50 });
  assert.deepEqual(resolveMindmapFiles(parsed, 'C:\\maps\\work.mdmap', path.win32), input);
});

test('independent node connections survive serialization without changing tree parents', async () => {
  const { validateMindmap, parseMindmap, serializeMindmap } = await model();
  const input = { ...map([node('root', null), node('a', 'root'), node('b', 'root')]), version: 2, connections: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'br', from: 'b', to: 'root' }] };
  const result = validateMindmap(input); result.connections[0].to = 'root';
  assert.equal(input.connections[0].to, 'b');
  assert.deepEqual(parseMindmap(serializeMindmap(input)), input);
  assert.equal(input.nodes[1].parent, 'root');
});

test('broken, self, duplicate and unversioned node connections are refused', async () => {
  const { validateMindmap } = await model();
  const data = { ...map([node('root', null), node('a', 'root')]), version: 2 };
  const edge = { id: 'edge', from: 'root', to: 'a' };
  for (const connections of [null, {}, [null], [{ ...edge, to: 'missing' }], [{ ...edge, to: 'root' }], [edge, { ...edge, id: 'other', from: 'a', to: 'root' }], [edge, edge], Array.from({ length: 2001 }, () => edge)]) {
    assert.throws(() => validateMindmap({ ...data, connections }));
  }
  assert.throws(() => validateMindmap({ ...data, version: 1, connections: [edge] }));
});

test('node colors roundtrip together with manual positions and relations in version 3', async () => {
  const { validateMindmap, parseMindmap, serializeMindmap } = await model();
  const input = { ...map([node('root', null), node('a', 'root', { color: '#C03A59', offset: { x: -80, y: 25 } })]), version: 3, connections: [{ id: 'ra', from: 'root', to: 'a' }] };
  const normalized = validateMindmap(input);
  assert.equal(normalized.nodes[1].color, '#c03a59');
  assert.equal(Object.hasOwn(normalized.nodes[0], 'color'), false, 'default text color remains theme-driven');
  assert.deepEqual(parseMindmap(serializeMindmap(input)), normalized);
  assert.equal(input.nodes[1].color, '#C03A59', 'normalization does not mutate the source');
  normalized.nodes[1].color = '#000000';
  assert.equal(input.nodes[1].color, '#C03A59');
});

test('invalid or unversioned colors are rejected instead of discarded or interpreted as CSS', async () => {
  const { validateMindmap } = await model();
  for (const color of [null, undefined, {}, '', 'red', '#fff', '#12345678', '#gg0000', 'url(x)', '#112233;display:none', '#123456\n', '#123456\r']) {
    assert.throws(() => validateMindmap({ ...map([node('root', null, { color })]), version: 3, connections: [] }));
  }
  for (const version of [1, 2]) assert.throws(() => validateMindmap({ ...map([node('root', null, { color: '#123456' })]), version, ...(version === 2 ? { connections: [] } : {}) }));
  assert.throws(() => validateMindmap({ ...map(), version: 3 }), 'v3 requires connections to protect relation data');
  assert.throws(() => validateMindmap({ ...map(), version: 5, connections: [] }));
});

test('version 4 preserves backgrounds, every supported style and labeled relations without sharing data', async () => {
  const { validateMindmap, parseMindmap, serializeMindmap } = await model();
  const styles = ['plain', 'rounded', 'note', 'capsule', 'double'];
  const input = { ...map([node('root', null), ...styles.map((style, index) => node('n' + index, 'root', { style, background: '#A9CDEE', color: '#123ABC', offset: { x: index * 23, y: -30 } }))]), version: 4,
    connections: [{ id: 'edge', from: 'n0', to: 'n1', label: '  关联 关系 😀 <标签>  ' }, { id: 'empty', from: 'n1', to: 'n2', label: '' }, { id: 'plain', from: 'n2', to: 'n3' }] };
  const result = validateMindmap(input);
  assert.deepEqual(result.nodes.slice(1).map(item => item.style), styles);
  assert.equal(result.nodes[1].background, '#a9cdee'); assert.equal(result.nodes[1].color, '#123abc');
  assert.equal(Object.hasOwn(result.nodes[0], 'background'), false); assert.equal(Object.hasOwn(result.nodes[0], 'style'), false);
  assert.equal(result.connections[0].label, input.connections[0].label); assert.equal(result.connections[1].label, '');
  assert.equal(Object.hasOwn(result.connections[2], 'label'), false);
  assert.deepEqual(parseMindmap(serializeMindmap(input)), result);
  result.nodes[1].background = '#000000'; result.nodes[1].style = 'double'; result.nodes[1].offset.x = 900;
  result.connections[0].label = 'modified';
  assert.equal(input.nodes[1].background, '#A9CDEE'); assert.equal(input.nodes[1].style, 'plain'); assert.equal(input.nodes[1].offset.x, 0);
  assert.equal(input.connections[0].label, '  关联 关系 😀 <标签>  ');
});

test('background and style reject unsafe values and version 1 through 3 never discard new appearance data', async () => {
  const { validateMindmap } = await model();
  for (const background of [null, undefined, {}, '', 'white', '#fff', '#12345678', 'url(x)', '#gg1122', '#112233;opacity:0', '#123456\n', '#123456\r']) {
    assert.throws(() => validateMindmap({ ...map([node('root', null, { background })]), version: 4, connections: [] }));
  }
  for (const style of [null, undefined, {}, '', 'Rounded', 'square', 'note capsule', 'url(x)']) {
    assert.throws(() => validateMindmap({ ...map([node('root', null, { style })]), version: 4, connections: [] }));
  }
  for (const version of [1, 2, 3]) for (const appearance of [{ background: '#123456' }, { style: 'plain' }, { background: undefined }, { style: undefined }]) {
    assert.throws(() => validateMindmap({ ...map([node('root', null, appearance)]), version, ...(version >= 2 ? { connections: [] } : {}) }));
  }
});

test('connection labels have a strict single-line 200-character boundary and require version 4', async () => {
  const { validateMindmap } = await model();
  const base = { ...map([node('root', null), node('a', 'root')]), version: 4 };
  const edge = { id: 'edge', from: 'root', to: 'a' };
  for (const label of ['', ' ', '中文 😀 symbols & <b>', 'a'.repeat(200), '😀'.repeat(100)]) {
    assert.equal(validateMindmap({ ...base, connections: [{ ...edge, label }] }).connections[0].label, label);
  }
  for (const label of [null, undefined, 1, [], {}, 'a'.repeat(201), '😀'.repeat(101), 'line\nnext', 'line\rnext', 'tab\ttext', 'a\0b', 'a\x7fb', 'a\x85b', 'a\u2028b', 'a\u2029b']) {
    assert.throws(() => validateMindmap({ ...base, connections: [{ ...edge, label }] }));
  }
  for (const version of [2, 3]) for (const label of ['', 'relation', undefined]) {
    assert.throws(() => validateMindmap({ ...base, version, connections: [{ ...edge, label }] }));
  }
  assert.throws(() => validateMindmap({ ...base, connections: undefined }));
});

test('version 4 save-as rebases only file links while version 1 through 3 remain unchanged', async () => {
  const { serializeMindmapForPath, resolveMindmapFiles } = await paths();
  const { parseMindmap, serializeMindmap } = await model();
  const input = { ...map([node('root', null, { file: 'C:\\notes\\linked.md', background: '#fef1ac', style: 'note' }), node('a', 'root')]), version: 4,
    connections: [{ id: 'edge', from: 'root', to: 'a', label: 'depends on' }] };
  const stored = parseMindmap(serializeMindmapForPath(input, 'C:\\maps\\work.mdmap', path.win32));
  assert.equal(stored.nodes[0].file, '../notes/linked.md'); assert.equal(stored.nodes[0].background, '#fef1ac'); assert.equal(stored.nodes[0].style, 'note');
  assert.equal(stored.connections[0].label, 'depends on');
  assert.deepEqual(resolveMindmapFiles(stored, 'C:\\maps\\work.mdmap', path.win32), input);
  for (const version of [1, 2, 3]) {
    const old = { ...map(), version, ...(version >= 2 ? { connections: [] } : {}) };
    assert.deepEqual(parseMindmap(serializeMindmap(old)), old);
  }
});

test('save-as and file resolution preserve node colors and the previous format stays unchanged', async () => {
  const { serializeMindmapForPath, resolveMindmapFiles } = await paths();
  const { parseMindmap, validateMindmap } = await model();
  const input = { ...map([node('root', null, { color: '#168080', file: 'C:\\notes\\linked.md' })]), version: 3, connections: [] };
  const stored = parseMindmap(serializeMindmapForPath(input, 'C:\\maps\\work.mdmap', path.win32));
  assert.equal(stored.nodes[0].color, '#168080');
  assert.equal(stored.nodes[0].file, '../notes/linked.md');
  assert.deepEqual(resolveMindmapFiles(stored, 'C:\\maps\\work.mdmap', path.win32), input);
  const legacy = { ...map(), version: 2, connections: [] };
  assert.deepEqual(validateMindmap(legacy), legacy);
});

test('invalid versions, duplicate ids, orphan nodes, cycles, and extra roots are refused', async () => {
  const { validateMindmap } = await model();
  const invalid = [null, [], {}, { ...map(), version: 2 }, { ...map(), format: 'other' }, { ...map(), root: 'missing' }, map([]),
    map([node('root', null), node('root', 'root')]), map([node('root', null), node('a', 'missing')]),
    map([node('root', null), node('a', 'b'), node('b', 'a')]), map([node('root', null), node('a', null)]),
    map([node('root', 'root')]), map([node('root', null, { text: 2 })]), map([node('root', null, { collapsed: 'true' })]),
    map([node('root', null, { file: {} })])];
  for (const input of invalid) assert.throws(() => validateMindmap(input));
});

test('tree limits accept the boundary and reject excessive nodes, text, or depth', async () => {
  const { validateMindmap } = await model();
  const wide = map([node('root', null), ...Array.from({ length: 999 }, (_, i) => node('n' + i, 'root'))]);
  assert.equal(validateMindmap(wide).nodes.length, 1000);
  assert.throws(() => validateMindmap(map([...wide.nodes, node('extra', 'root')])));
  assert.equal(validateMindmap(map([node('root', null, { text: '字'.repeat(500) })])).nodes[0].text.length, 500);
  assert.throws(() => validateMindmap(map([node('root', null, { text: '字'.repeat(501) })])));
  const deep = map([node('root', null), ...Array.from({ length: 63 }, (_, i) => node('n' + i, i ? 'n' + (i - 1) : 'root'))]);
  assert.equal(validateMindmap(deep).nodes.length, 64);
  assert.throws(() => validateMindmap(map([...deep.nodes, node('extra', 'n62')])));
});

test('linked paths allow Markdown files and reject URI schemes, controls and other extensions', async () => {
  const { validateMindmap } = await model();
  for (const file of ['../中文.md', 'notes/文档.markdown', 'C:\\笔记\\内容.md', 'D:/notes/test.MD', '/notes/test.md', '\\\\server\\share\\note.md']) {
    assert.equal(validateMindmap(map([node('root', null, { file })])).nodes[0].file, file);
  }
  for (const file of ['', 'a.txt', 'a.md.exe', 'file:///C:/notes/a.md', 'https://example.com/a.md', 'javascript:a.md', 'C:notes.md', 'a\u0000.md', 'a\n.md', 'C:\\notes\\a.md:extra.md', '\\\\?\\C:\\notes\\a.md']) {
    assert.throws(() => validateMindmap(map([node('root', null, { file })])), undefined, file);
  }
});

test('relative links resolve from the map folder and save-as preserves the original Markdown target', async () => {
  const { resolveMindmapFiles, serializeMindmapForPath } = await paths();
  const { parseMindmap } = await model();
  const original = map([node('root', null), node('a', 'root', { file: '../notes/中文.md' }), node('b', 'root', { file: 'D:\\notes\\remote.markdown' })]);
  const loaded = resolveMindmapFiles(original, 'C:\\project\\maps\\plan.mdmap', path.win32);
  assert.equal(loaded.nodes[1].file, 'C:\\project\\notes\\中文.md');
  assert.equal(loaded.nodes[2].file, 'D:\\notes\\remote.markdown');
  const saved = parseMindmap(serializeMindmapForPath(loaded, 'C:\\archive\\plan.mdmap', path.win32));
  assert.equal(saved.nodes[1].file, '../project/notes/中文.md');
  assert.equal(saved.nodes[2].file, 'D:\\notes\\remote.markdown');
  assert.deepEqual(resolveMindmapFiles(saved, 'C:\\archive\\plan.mdmap', path.win32), loaded);
  assert.equal(original.nodes[1].file, '../notes/中文.md');
  assert.throws(() => resolveMindmapFiles(original, null, path.win32), /保存|绝对|位置/);
  assert.throws(() => serializeMindmapForPath(original, 'C:\\archive\\plan.mdmap', path.win32), /绝对/);
});

test('mindmap file extension is explicit while default Markdown naming remains intact', () => {
  assert.equal(files.normalizeDocumentName('计划', 'mdmap'), '计划.mdmap');
  assert.equal(files.normalizeDocumentName('计划.MDMAP', 'mdmap'), '计划.MDMAP');
  assert.equal(files.normalizeDocumentName('计划'), '计划.md');
  assert.equal(files.normalizeDocumentName('计划.markdown'), '计划.markdown');
  assert.throws(() => files.normalizeDocumentName('.mdmap', 'mdmap'));
  assert.throws(() => files.normalizeDocumentName('NUL.mdmap', 'mdmap'));
});

test('mindmap rename preserves bytes and case-only names without replacing an existing file', async t => {
  const dir = await mkdtemp(path.join(process.cwd(), '.test-mindmap-'));
  assert.equal(path.dirname(path.resolve(dir)), process.cwd());
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, '计划.mdmap');
  await writeFile(original, JSON.stringify(map()));
  const before = await files.readDocument(original);
  const renamed = await files.renameDocument(original, 'Plan.mdmap', before.fingerprint, 'mdmap');
  assert.equal(renamed, path.join(dir, 'Plan.mdmap'));
  const changedCase = await files.renameDocument(renamed, 'PLAN.mdmap', before.fingerprint, 'mdmap');
  assert.deepEqual(await readdir(dir), ['PLAN.mdmap']);
  await writeFile(path.join(dir, '已有.mdmap'), 'preserve');
  await assert.rejects(files.renameDocument(changedCase, '已有.mdmap', before.fingerprint, 'mdmap'), /已存在/);
  assert.equal(await readFile(changedCase, 'utf8'), before.content);
  assert.equal(await readFile(path.join(dir, '已有.mdmap'), 'utf8'), 'preserve');
});
