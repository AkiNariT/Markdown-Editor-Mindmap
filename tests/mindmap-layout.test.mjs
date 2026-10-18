import test from 'node:test';
import assert from 'node:assert/strict';
const model = await import('../src/mindmap-layout.mjs').catch(error => { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {}; });
const node = (id, parent, extra = {}) => ({ id, parent, text: id, file: null, collapsed: false, ...extra });
const map = nodes => ({ format: 'md-mindmap', version: 6, root: 'root', nodes, connections: [] });

test('short default titles retain 216 by 96 cards and existing automatic positions', () => {
  assert.equal(typeof model.layoutMindmap, 'function');
  const result = model.layoutMindmap(map([node('root', null), node('a', 'root'), node('b', 'root')]), { paddingX: 400, paddingY: 250 });
  assert.deepEqual(result.positions.get('root'), { x: 400, y: 310, width: 216, height: 96 });
  assert.deepEqual(result.positions.get('a'), { x: 692, y: 250, width: 216, height: 96 });
  assert.deepEqual(result.positions.get('b'), { x: 692, y: 370, width: 216, height: 96 });
});

test('full CJK, Latin, explicit line breaks and subtitles grow cards without clipping or text loss', () => {
  assert.equal(typeof model.measureNode, 'function');
  for (const text of ['中文'.repeat(250), 'longword'.repeat(60), 'first\n\nlast', '👨‍👩‍👧‍👦'.repeat(20)]) {
    const measured = model.measureNode(node('r', null, { text, subtitle: '说明'.repeat(40), file: 'read.md' }));
    assert.equal(measured.titleLines.join('').replace(/\r/g, ''), text.replace(/\r?\n/g, ''));
    assert.ok(measured.height > 96);
    assert.ok(measured.height >= measured.titleLines.length * 23 + measured.subtitleLines.length * 19 + 8 + 36);
  }
  assert.deepEqual(model.wrapNodeText('first\n\nlast', 200, 16), ['first', '', 'last']);
  assert.ok(model.measureNode(node('r', null, { text: '测试'.repeat(30) }), 'compact').height > model.measureNode(node('r', null, { text: '测试'.repeat(30) }), 'wide').height);
});

test('variable-height siblings do not overlap, collapsed descendants stay hidden, and inherited offsets/group drags remain stable', () => {
  assert.equal(typeof model.layoutMindmap, 'function');
  const input = map([node('root', null, { offset: { x: -50, y: 10 } }), node('a', 'root', { text: '字'.repeat(300), offset: { x: 20, y: 5 } }), node('b', 'root', { collapsed: true }), node('hidden', 'b')]);
  const normal = model.layoutMindmap(input), moved = model.layoutMindmap(input, { drag: { kind: 'node', nodeIds: new Set(['root']), dx: 40, dy: -10 } });
  const a = normal.positions.get('a'), b = normal.positions.get('b');
  assert.ok(a.y + a.height < b.y);
  assert.equal(normal.positions.has('hidden'), false);
  for (const [id, pos] of normal.positions) { assert.equal(moved.positions.get(id).x, pos.x + 40); assert.equal(moved.positions.get(id).y, pos.y - 10); }
  assert.equal(normal.bounds.left, -50);
  assert.equal(input.nodes[0].offset.x, -50);
});
