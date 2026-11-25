import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapOrigins } from '../src/map-origins.mjs';

test('a tab remembers the latest node open, separately from ordinary tab activation and direct file opens', () => {
  const origins = createMapOrigins(() => true);
  const first = { mapId: 'map-a', nodeId: 'shared' }, last = { mapId: 'map-b', nodeId: 'other' };
  origins.open('article', first);
  origins.open('draft', first);
  origins.open('article');
  assert.deepEqual(origins.get('article'), first);
  origins.open('article', last);
  assert.deepEqual(origins.get('article'), last);
  assert.deepEqual(origins.get('draft'), first);
  origins.open('article', null);
  assert.equal(origins.get('article'), undefined);
});

test('closed maps and documents leave no dangling returns, and removed nodes are unavailable', () => {
  const nodes = new Set(['a', 'b']);
  const origins = createMapOrigins((_id, node) => nodes.has(node));
  origins.open('one', { mapId: 'map', nodeId: 'a' });
  origins.open('two', { mapId: 'map', nodeId: 'b' });
  nodes.delete('b'); assert.equal(origins.get('two'), undefined);
  origins.close('one'); assert.equal(origins.get('one'), undefined);
  origins.close('map'); nodes.add('b'); assert.equal(origins.get('two'), undefined);
});
