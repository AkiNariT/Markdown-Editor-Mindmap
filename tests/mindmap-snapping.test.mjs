import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const load = () => import('../src/mindmap-snapping.mjs');
const positions = entries => new Map(entries.map(([id, x, y]) => [id, { x, y }]));

test('a dragged card snaps within six screen pixels and gives a guide across both cards', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 20, 30], ['b', 200, 300]]), { anchorId: 'a', movingIds: ['a'] });
  assert.deepEqual(snapper.snap(176, 40), {
    dx: 180, dy: 40,
    guides: [{ axis: 'x', value: 308, start: 58, end: 408, targetId: 'b' }],
  });
  assert.deepEqual(snapper.snap(172, 40), { dx: 172, dy: 40, guides: [] }, 'moving away releases alignment without sticky accumulated deltas');
});

test('a card can align on both axes with different stationary cards', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['vertical', 100, 500], ['horizontal', 600, 200]]), { anchorId: 'a' });
  assert.deepEqual(snapper.snap(96, 204), {
    dx: 100, dy: 200,
    guides: [
      { axis: 'x', value: 208, start: 188, end: 608, targetId: 'vertical' },
      { axis: 'y', value: 248, start: 88, end: 828, targetId: 'horizontal' },
    ],
  });
});

test('the snap distance is six displayed pixels at every canvas zoom', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['b', 100, 400]]), { anchorId: 'a' });
  assert.equal(snapper.snap(96, 0, { zoom: 200 }).dx, 96, 'eight displayed pixels must not snap');
  assert.equal(snapper.snap(97, 0, { zoom: 200 }).dx, 100, 'six displayed pixels snaps inclusively');
  assert.equal(snapper.snap(89, 0, { zoom: 50 }).dx, 100, '5.5 displayed pixels snaps when zoomed out');
  assert.equal(snapper.snap(87, 0, { zoom: 50 }).dx, 87);
});

test('Alt temporarily bypasses snapping and releases all guides without rebuilding the drag', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['b', 100, 400]]), { anchorId: 'a' });
  assert.equal(snapper.snap(96, 0).dx, 100);
  assert.deepEqual(snapper.snap(96, 0, { disabled: true }), { dx: 96, dy: 0, guides: [] });
  assert.equal(snapper.snap(96, 0).dx, 100);
});

test('selected cards and all moving descendants are excluded as alignment targets', async () => {
  const { createMindmapSnapper } = await load();
  const points = positions([['a', 0, 0], ['selected', 96, 400], ['descendant', 98, 450], ['stationary', 100, 600]]);
  const snapper = createMindmapSnapper(points, { anchorId: 'a', movingIds: new Set(['a', 'selected', 'descendant']) });
  const result = snapper.snap(96, 13);
  assert.equal(result.dx, 100);
  assert.equal(result.guides[0].targetId, 'stationary');
  const moved = ['a', 'selected', 'descendant'].map(id => ({ x: points.get(id).x + result.dx, y: points.get(id).y + result.dy }));
  assert.deepEqual(moved, [{ x: 100, y: 13 }, { x: 196, y: 413 }, { x: 198, y: 463 }], 'one shared delta preserves relative group positions');
  assert.deepEqual(points.get('a'), { x: 0, y: 0 }, 'dragging never mutates the starting positions');
});

test('the nearest alignment wins, with orthogonal distance resolving equally close targets', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['far', 100, 1000], ['near', 104, 300], ['closer-axis', 101, 1400]]), { anchorId: 'a' });
  assert.equal(snapper.snap(102, 0).guides[0].targetId, 'closer-axis', 'axis precision wins before orthogonal distance');
  const tied = createMindmapSnapper(positions([['a', 0, 0], ['far', 100, 1000], ['near', 104, 300]]), { anchorId: 'a' });
  assert.equal(tied.snap(102, 0).guides[0].targetId, 'near');
});

test('snap candidates beyond group movement limits do not create false alignment guides', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['out', 100, 600], ['in', 96, 400]]), { anchorId: 'a' });
  const bounds = { minDx: -40, maxDx: 98, minDy: -80, maxDy: 500 };
  const result = snapper.snap(99, 0, { bounds });
  assert.equal(result.dx, 96); assert.equal(result.guides[0].targetId, 'in');
  assert.deepEqual(snapper.snap(99, 0, { bounds: { ...bounds, maxDx: 95 } }), { dx: 99, dy: 0, guides: [] });
  const negative = createMindmapSnapper(positions([['a', 0, 0], ['b', -100, -200]]), { anchorId: 'a' });
  assert.deepEqual(negative.snap(-96, -196, { bounds: { minDx: -98, maxDx: 0, minDy: -198, maxDy: 0 } }), { dx: -96, dy: -196, guides: [] });
});

test('a nearby facing edge does not attract a side-by-side card into an overlap', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 0, 0], ['b', 300, 400]]), { anchorId: 'a' });
  assert.deepEqual(snapper.snap(80, 0), { dx: 80, dy: 0, guides: [] }, 'right-to-left and edge-to-center pairs are not alignment targets');
});

test('a drag uses an isolated starting snapshot even if the caller updates its positions map', async () => {
  const { createMindmapSnapper } = await load();
  const points = positions([['a', 20, 30], ['b', 200, 300]]), movingIds = new Set(['a']);
  const snapper = createMindmapSnapper(points, { anchorId: 'a', movingIds });
  points.get('a').x = 900; points.get('b').x = 1200; points.delete('b'); movingIds.add('b');
  assert.equal(snapper.snap(176, 40).dx, 180);
});

test('maps without stationary targets or without the grabbed card retain the requested movement', async () => {
  const { createMindmapSnapper } = await load();
  const points = positions([['a', 20, 30], ['b', 200, 300]]);
  assert.deepEqual(createMindmapSnapper(points, { anchorId: 'a', movingIds: ['a', 'b'] }).snap(176, 40), { dx: 176, dy: 40, guides: [] });
  assert.deepEqual(createMindmapSnapper(points, { anchorId: 'hidden' }).snap(176, 40), { dx: 176, dy: 40, guides: [] });
});

test('custom equal card sizes align both centers and matching edges', async () => {
  const { createMindmapSnapper } = await load();
  const snapper = createMindmapSnapper(positions([['a', 20, 30], ['b', 200, 300]]), { anchorId: 'a', width: 100, height: 50 });
  const result = snapper.snap(176, 40);
  assert.deepEqual(result, { dx: 180, dy: 40, guides: [{ axis: 'x', value: 250, start: 58, end: 362, targetId: 'b' }] });
});

test('repeated pointer queries remain practical for a thousand-card map', async t => {
  const { createMindmapSnapper } = await load();
  const points = new Map([['a', { x: -500, y: -500 }]]);
  for (let i = 0; i < 1000; i++) points.set(`node-${i}`, { x: (i % 25) * 300, y: Math.floor(i / 25) * 140 });
  const snapper = createMindmapSnapper(points, { anchorId: 'a' });
  const started = performance.now();
  for (let i = 0; i < 1000; i++) {
    const result = snapper.snap(497 + (i % 25) * 300, 497 + Math.floor(i / 25) * 140);
    assert.equal(result.dx, 500 + (i % 25) * 300); assert.equal(result.dy, 500 + Math.floor(i / 25) * 140);
    assert.equal(result.guides.length, 2);
  }
  const elapsed = performance.now() - started;
  t.diagnostic(`1,000 snap queries across 1,000 stationary cards: ${elapsed.toFixed(2)} ms`);
  assert.ok(elapsed < 2000, `geometry work exceeded two milliseconds per query on average: ${elapsed.toFixed(2)} ms`);
});
