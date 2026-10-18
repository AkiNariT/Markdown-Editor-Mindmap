import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMindmap, parseMindmap, serializeMindmap } from '../src/mindmap.mjs';
import path from 'node:path';
import { resolveMindmapFiles, serializeMindmapForPath } from '../src/mindmap-files.mjs';

const node = (id, parent, extra = {}) => ({ id, parent, text: id, file: null, collapsed: false, ...extra });
const base = () => ({ format: 'md-mindmap', version: 6, root: 'root', nodes: [node('root', null), node('child', 'root')], connections: [] });

test('v6 preserves subtitles, node sizes, line geometry and relation appearance through save/reopen', () => {
  const input = { ...base(), lineStyle: 'orthogonal', nodeSize: 'wide', theme: 'crystal' };
  input.nodes[0].subtitle = '完整说明\n第二行 😀';
  input.connections.push({ id: 'relation', from: 'root', to: 'child', style: 'solid', arrow: 'both', color: '#AB12CD', label: '解释' });
  const normalized = validateMindmap(input);
  assert.equal(normalized.connections[0].color, '#ab12cd');
  assert.equal(input.connections[0].color, '#AB12CD');
  assert.deepEqual(parseMindmap(serializeMindmap(input)), normalized);
  for (const lineStyle of ['curve', 'orthogonal', 'straight']) assert.equal(validateMindmap({ ...base(), lineStyle }).lineStyle, lineStyle);
  for (const nodeSize of ['compact', 'standard', 'wide']) assert.equal(validateMindmap({ ...base(), nodeSize }).nodeSize, nodeSize);
});

test('new fields cannot be silently lost by older format versions', () => {
  for (let version = 1; version <= 5; version++) {
    const old = { ...base(), version }; if (version === 1) delete old.connections;
    assert.throws(() => validateMindmap({ ...old, lineStyle: 'curve' }));
    assert.throws(() => validateMindmap({ ...old, nodeSize: 'wide' }));
    assert.throws(() => validateMindmap({ ...old, nodes: [node('root', null, { subtitle: '' })] }));
    if (version > 1) for (const extra of [{ style: 'solid' }, { arrow: 'end' }, { color: '#123456' }]) {
      assert.throws(() => validateMindmap({ ...old, connections: [{ id: 'edge', from: 'root', to: 'child', ...extra }] }));
    }
    assert.deepEqual(validateMindmap(old), old);
  }
});

test('v6 rejects invalid enum, color, subtitle and newer unsupported format values', () => {
  for (const lineStyle of [null, '', 'Curve', 'url(x)']) assert.throws(() => validateMindmap({ ...base(), lineStyle }));
  for (const nodeSize of [null, '', 200, 'huge']) assert.throws(() => validateMindmap({ ...base(), nodeSize }));
  for (const subtitle of [null, 7, {}, 'a'.repeat(501)]) assert.throws(() => validateMindmap({ ...base(), nodes: [node('root', null, { subtitle })] }));
  assert.equal(validateMindmap({ ...base(), nodes: [node('root', null, { subtitle: '字'.repeat(500) })] }).nodes[0].subtitle.length, 500);
  for (const extra of [{ style: 'curve' }, { arrow: 'start' }, { color: 'red' }, { color: '#fff' }, { color: '#112233\n' }]) {
    assert.throws(() => validateMindmap({ ...base(), connections: [{ id: 'edge', from: 'root', to: 'child', ...extra }] }));
  }
  assert.throws(() => validateMindmap({ ...base(), version: 7 }));
});

test('v6 save-as rebases attached Markdown while retaining every new appearance field', () => {
  const input = { ...base(), lineStyle: 'straight', nodeSize: 'compact' };
  input.nodes[1].file = 'C:\\lecture\\notes\\chapter.md'; input.nodes[1].subtitle = '副标题\n说明';
  input.connections.push({ id: 'edge', from: 'root', to: 'child', style: 'dashed', arrow: 'end', color: '#123456' });
  const text = serializeMindmapForPath(input, 'C:\\lecture\\map.mdmap', path.win32);
  assert.equal(parseMindmap(text).nodes[1].file, 'notes/chapter.md');
  assert.deepEqual(resolveMindmapFiles(parseMindmap(text), 'C:\\lecture\\map.mdmap', path.win32), input);
});
