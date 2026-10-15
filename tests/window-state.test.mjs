import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
const module = await import('../src/window-state.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const resolveState = (...args) => { assert.equal(typeof module.resolveWindowState, 'function', 'window restoration must exist'); return module.resolveWindowState(...args); };
const primary = { id: 1, scaleFactor: 1.5, workArea: { x: 0, y: 40, width: 1280, height: 760 } };

test('normal DIP bounds survive high-DPI restoration without multiplying the scale', () => {
  const state = resolveState({ bounds: { x: 50, y: 80, width: 900, height: 650 }, maximized: true, minimized: true }, [primary], 1);
  assert.deepEqual(state.bounds, { x: 50, y: 80, width: 900, height: 650 });
  assert.equal(state.maximized, true); assert.equal('minimized' in state, false);
});
test('a removed monitor returns every edge to the nearest available work area', () => {
  const state = resolveState({ bounds: { x: 2300, y: -400, width: 1800, height: 1200 } }, [primary], 1);
  assert.deepEqual(state.bounds, { x: 0, y: 40, width: 1280, height: 760 });
});
test('negative-coordinate second monitors retain their own DIP location', () => {
  const other = { id: 2, scaleFactor: 2, workArea: { x: -1600, y: 0, width: 1600, height: 900 } };
  const state = resolveState({ bounds: { x: -1450, y: 90, width: 1000, height: 700 } }, [primary, other], 1);
  assert.deepEqual(state.bounds, { x: -1450, y: 90, width: 1000, height: 700 });
});
test('small work areas reduce native minimum size so all controls remain reachable', () => {
  const state = resolveState(null, [{ id: 1, workArea: { x: 20, y: 10, width: 640, height: 420 } }], 1);
  assert.deepEqual(state.bounds, { x: 20, y: 10, width: 640, height: 420 });
  assert.equal(state.minWidth, 640); assert.equal(state.minHeight, 420);
});
test('invalid persisted values use centered primary defaults and ignore maximized junk', () => {
  const state = resolveState({ bounds: { x: Infinity, y: 0, width: -1, height: 800 }, maximized: 'true' }, [primary], 1);
  assert.deepEqual(state.bounds, { x: 50, y: 40, width: 1180, height: 760 });
  assert.equal(state.maximized, false);
});
test('window state writes are serialized and corrupt metadata cannot prevent startup', async t => {
  const profile = await mkdtemp(join(process.cwd(), '.window-state-test-')); t.after(() => rm(profile, { recursive: true, force: true }));
  assert.equal(typeof module.createWindowStateStore, 'function'); const store = module.createWindowStateStore(profile);
  assert.equal(await store.load(), null);
  const first = { bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: false }, second = { bounds: { x: 30, y: 40, width: 900, height: 700 }, maximized: true };
  const writes = [store.save(first), store.save(second)]; second.bounds.x = 777;
  await Promise.all(writes); const loaded = await store.load();
  assert.deepEqual(loaded, { bounds: { x: 30, y: 40, width: 900, height: 700 }, maximized: true });
  assert.deepEqual(await readdir(profile), ['window-state.json']);
  await assert.rejects(store.save({ bounds: { x: NaN, y: 0, width: 1, height: 1 } }));
  assert.equal(JSON.parse(await readFile(join(profile, 'window-state.json'), 'utf8')).bounds.x, 30);
  await writeFile(join(profile, 'window-state.json'), '{broken'); assert.equal(await store.load(), null);
});
