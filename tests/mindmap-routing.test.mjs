import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const routing = await import('../src/mindmap-routing.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const router = (items, options) => {
  assert.equal(typeof routing.createMindmapRouter, 'function', 'the obstacle-avoiding router must exist');
  return routing.createMindmapRouter(new Map(Object.entries(items)), options);
};

// Inspect densely sampled output against actual cards independently of the router's
// collision routine. A point on a card boundary is a valid attachment, not a hit.
function assertClear(route, cards, { width = 216, height = 96 } = {}) {
  assert.ok(route && route.d && route.points.length >= 2);
  assert.notEqual(route.blocked, true, 'a non-overlapping layout must have a clear route');
  assert.ok(Number.isFinite(route.midpoint.x) && Number.isFinite(route.midpoint.y));
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps };
      for (const [id, card] of Object.entries(cards)) {
        assert.ok(!(p.x > card.x + .001 && p.x < card.x + (card.width ?? width) - .001 && p.y > card.y + .001 && p.y < card.y + (card.height ?? height) - .001), `path passes through ${id} at ${JSON.stringify(p)}`);
      }
      assert.ok(p.x >= route.bounds.left - 1 && p.x <= route.bounds.right + 1 && p.y >= route.bounds.top - 1 && p.y <= route.bounds.bottom + 1, 'bounds contain the visible path');
    }
  }
}

test('unobstructed curved, bowed and crystal branches keep their existing geometry', () => {
  const positions = { a: { x: 100, y: 100 }, b: { x: 500, y: 100 } };
  const routes = router(positions);
  const plain = routes.route('a', 'b');
  assert.equal(plain.d, 'M 316 148 C 408 148, 408 148, 500 148');
  assert.equal(plain.rerouted, false); assert.deepEqual(plain.midpoint, { x: 408, y: 148 });
  assert.equal(routes.route('a', 'b', { bow: 32 }).d, 'M 316 148 C 408 116, 408 116, 500 148');
  assert.equal(routes.route('a', 'b', { crystal: true }).d, 'M 316 148 L 396 148 L 420 148 L 500 148');
  assertClear(plain, positions);
});

test('straight and orthogonal styles attach to differently sized cards and avoid grown obstacles', () => {
  const positions = { a: { x: 0, y: 100, width: 180, height: 150 }, b: { x: 700, y: 200, width: 320, height: 240 } };
  const routes = router(positions);
  const direct = routes.route('a', 'b', { lineStyle: 'straight', crystal: true, bow: 32 });
  assert.match(direct.d, /^M [\d .-]+ L [\d .-]+$/);
  assert.equal(direct.points[0].x, 180); assert.equal(direct.points.at(-1).x, 700);
  assert.equal(direct.points[0].y, 175); assert.equal(direct.points.at(-1).y, 320);
  assertClear(direct, positions);
  const elbow = routes.route('a', 'b', { lineStyle: 'orthogonal', crystal: true });
  assert.ok(elbow.points.slice(1).every((p, i) => p.x === elbow.points[i].x || p.y === elbow.points[i].y));
  assertClear(elbow, positions);
  const blocked = { ...positions, blocker: { x: 300, y: 0, width: 300, height: 600 } };
  for (const lineStyle of ['curve', 'straight', 'orthogonal']) {
    const route = router(blocked).route('a', 'b', { lineStyle });
    assert.equal(route.rerouted, true); assertClear(route, blocked);
  }
});

test('a card placed across a branch is routed around with room for its collapse button', () => {
  const positions = { a: { x: 0, y: 100 }, b: { x: 700, y: 100 }, obstacle: { x: 350, y: 70 } };
  for (const style of [{}, { bow: 32 }, { crystal: true }]) {
    const result = router(positions).route('a', 'b', style);
    assert.equal(result.rerouted, true); assertClear(result, positions);
    assertClear(result, { button: { x: 566, y: 70 } }, { width: 14, height: 96 });
    assert.ok(result.points.some(p => p.y <= 62 || p.y >= 174), 'route leaves a visible gap above or below the card');
  }
});

test('reverse and vertical connections avoid middle cards and their own endpoint interiors', () => {
  const fixtures = [
    { a: { x: 700, y: 100 }, b: { x: 0, y: 100 }, obstacle: { x: 350, y: 70 } },
    { a: { x: 200, y: 0 }, b: { x: 200, y: 500 }, obstacle: { x: 190, y: 200 } },
    { a: { x: 200, y: 500 }, b: { x: 200, y: 0 }, obstacle: { x: 190, y: 200 } },
    // The old dominant-axis curve attaches on overlapping horizontal extents and
    // loops through one of these diagonally close but non-overlapping cards.
    { a: { x: 100, y: 100 }, b: { x: 250, y: 210 } },
    { a: { x: 100, y: 100 }, b: { x: 250, y: -10 } },
  ];
  for (const positions of fixtures) for (const style of [{}, { bow: 32 }, { crystal: true }]) assertClear(router(positions).route('a', 'b', style), positions);
});

test('several staggered obstacles and nearly touching cards have an exterior route', () => {
  const positions = {
    a: { x: 0, y: 100 }, b: { x: 1000, y: 100 },
    c: { x: 300, y: 30 }, d: { x: 550, y: 110 }, e: { x: 800, y: -20 },
    above: { x: 0, y: 0 }, below: { x: 0, y: 200 },
  };
  assertClear(router(positions).route('a', 'b'), positions);
});

test('only supplied visible nodes obstruct paths, moved nodes get fresh routes, and input remains untouched', () => {
  const positions = { a: { x: 0, y: 100 }, b: { x: 700, y: 100 }, hidden: { x: 350, y: 70 } };
  const snapshot = structuredClone(positions);
  const visible = { a: positions.a, b: positions.b };
  assert.equal(router(visible).route('a', 'b').rerouted, false);
  assert.equal(router(positions).route('a', 'b').rerouted, true);
  assert.equal(router({ ...positions, hidden: { x: 350, y: 500 } }).route('a', 'b').rerouted, false);
  assert.deepEqual(positions, snapshot);
  assert.equal(router(positions).route('a', 'missing'), null);
  assert.equal(router(positions).route('a', 'a'), null);
});

test('long shallow bowed curves still detect cards between the chord and the drawn curve', () => {
  const positions = { a: { x: 0, y: 1000 }, b: { x: 100000, y: 1000 }, c: { x: 50000, y: 935 } };
  const result = router(positions).route('a', 'b', { bow: 32 });
  assert.equal(result.rerouted, true, 'the actual cubic passes through c even though its straight chord does not');
  assertClear(result, positions);
});

test('custom card dimensions are respected and completely overlapping cards terminate honestly', () => {
  const positions = { a: { x: -500, y: -200 }, b: { x: 100, y: -200 }, c: { x: -200, y: -210 } };
  assertClear(router(positions, { width: 100, height: 50 }).route('a', 'b'), positions, { width: 100, height: 50 });
  const overlap = router({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }).route('a', 'b');
  assert.equal(overlap.blocked, true); assert.ok(!/NaN|Infinity/.test(overlap.d));
});

test('1000 visible nodes and 999 connections have a bounded routing workload', t => {
  const positions = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), { x: (index % 25) * 300, y: Math.floor(index / 25) * 140 }]));
  const start = performance.now(), routes = router(positions);
  let rerouted = 0;
  for (let i = 1; i < 1000; i++) {
    const from = i % 25 === 0 ? String(i - 25) : String(i - 1), result = routes.route(from, String(i));
    assert.ok(result && !result.blocked); if (result.rerouted) rerouted++;
  }
  // Long edges must route past all the intermediate cards, too.
  for (let row = 0; row < 40; row++) {
    const result = routes.route(String(row * 25), String(row * 25 + 24));
    assert.ok(result.rerouted && !result.blocked); rerouted++;
  }
  const elapsed = performance.now() - start;
  t.diagnostic(`1000 nodes / 1039 routes: ${elapsed.toFixed(1)} ms, ${rerouted} rerouted`);
  // A loose hang guard, not a claimed machine-independent frame-time target.
  assert.ok(elapsed < 5000, `routing exceeded the bounded workload allowance: ${elapsed} ms`);
});

test('a default star with 1000 nodes uses the clear corridor between its root and children', t => {
  const positions = { root: { x: 400, y: 250 + (999 * 120 - 24 - 96) / 2 } };
  for (let index = 0; index < 999; index++) positions[`n${index}`] = { x: 692, y: 250 + index * 120 };
  const start = performance.now(), routes = router(positions);
  for (let index = 0; index < 999; index++) {
    const result = routes.route('root', `n${index}`);
    assert.ok(result && !result.blocked);
  }
  const elapsed = performance.now() - start;
  t.diagnostic(`1000-node default star: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 500, `the default layout must not run an expensive search per child: ${elapsed} ms`);
});

test('a staggered corridor uses bounded search when simple outer doglegs cannot escape', () => {
  const positions = {
    a: { x: 568, y: 669 }, b: { x: 1603, y: 513 },
    c: { x: 1373, y: 765 }, d: { x: 1196, y: 632 }, e: { x: 379, y: 492 },
    f: { x: 1635, y: 926 }, g: { x: 640, y: 551 },
  };
  assertClear(router(positions).route('a', 'b'), positions);
});

test('slightly irregular 1000-node grids find free lanes without per-edge grid searches', t => {
  let seed = 44;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const positions = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), {
    x: index % 25 * 300 + Math.floor(random() * 20), y: Math.floor(index / 25) * 140 + Math.floor(random() * 15),
  }]));
  const start = performance.now(), routes = router(positions, { maxSearch: 0 });
  for (let index = 1; index < 1000; index++) {
    const result = routes.route(String(Math.floor((index - 1) / 3)), String(index));
    assert.ok(result && !result.blocked, `free grid lanes were missed for ${index}`);
  }
  const elapsed = performance.now() - start;
  t.diagnostic(`1000-node irregular grid / 999 cross-grid routes: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 1500, `simple lane finding unexpectedly became expensive: ${elapsed} ms`);
});
