import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/locales/app.mjs';
import backend from '../src/locales/backend.mjs';
import workspace from '../src/locales/workspace.mjs';
import mindmapModel from '../src/locales/mindmap-model.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { Script } from 'node:vm';

test('English catalogs preserve named values and agree on shared interface labels', () => {
  const seen = new Map();
  const names = text => [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();
  for (const catalog of [app, backend, workspace, mindmapModel]) {
    assert.ok(Object.keys(catalog).length > 0, 'catalog must contain translations');
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', key); assert.ok(value.trim(), key);
      assert.deepEqual(names(value), names(key), key);
      assert.doesNotMatch(value, /\p{Script=Han}/u, key);
      if (seen.has(key)) assert.equal(value, seen.get(key), 'conflicting translation: ' + key);
      seen.set(key, value);
    }
  }
});

test('explicit translation calls and static interface markers have English entries', async () => {
  const messages = { ...app, ...backend, ...workspace, ...mindmapModel };
  const files = ['electron/main.cjs', ...(await readdir(new URL('../src/', import.meta.url))).filter(name => /\.(mjs|js)$/.test(name)).map(name => 'src/' + name)];
  for (const file of files) {
    const code = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of code.matchAll(/\bt\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) {
      // The expression is restricted to a single quoted string literal.
      const key = new Script('(' + match[1] + ')').runInNewContext({});
      if (/\p{Script=Han}/u.test(key)) assert.ok(Object.hasOwn(messages, key), file + ': ' + key);
    }
  }
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  try {
    for (const node of dom.window.document.querySelectorAll('*')) for (const attr of node.attributes) {
      if (attr.name === 'data-i18n' || attr.name.startsWith('data-i18n-')) assert.ok(Object.hasOwn(messages, attr.value), attr.name + ': ' + attr.value);
    }
  } finally { dom.window.close(); }
});
