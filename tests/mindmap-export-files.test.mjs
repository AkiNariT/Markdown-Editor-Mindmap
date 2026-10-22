import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { exportMindmap, exportFilePaths, rasterDimensions } = require('../electron/mindmap-export.cjs');
const data = { format: 'md-mindmap', version: 1, root: 'root', nodes: [{ id: 'root', parent: null, text: '测试导图', file: null, collapsed: false }] };
async function directory(t) { const dir = await mkdtemp(join(process.cwd(), '.test-export-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('canceling export does not create files or a rendering window', async t => {
  const dir = await directory(t);
  const result = await exportMindmap(null, data, { format: 'svg' }, { dialog: { showSaveDialog: async () => ({ canceled: true }) }, BrowserWindow: class { constructor() { throw new Error('must not render'); } } });
  assert.deepEqual(result, { canceled: true });
  assert.deepEqual(await readdir(dir), []);
});

test('SVG export writes inert vector content to the chosen file', async t => {
  const dir = await directory(t), path = join(dir, '导图.svg');
  const result = await exportMindmap(null, data, { format: 'svg' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path }) } });
  assert.deepEqual(result.paths, [path]);
  assert.equal(result.count, 1);
  assert.match(await readFile(path, 'utf8'), /<svg[^>]+xmlns=/);
  assert.deepEqual(await readdir(dir), ['导图.svg']);
});

test('declining replacement preserves an existing export and leaves no temporary files', async t => {
  const dir = await directory(t), path = join(dir, '导图.svg'); await writeFile(path, 'old export');
  const result = await exportMindmap(null, data, { format: 'svg' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path }), showMessageBox: async () => ({ response: 1 }) } });
  assert.equal(result.canceled, true);
  assert.equal(await readFile(path, 'utf8'), 'old export');
  assert.deepEqual(await readdir(dir), ['导图.svg']);
});

test('confirmed replacement writes the new content and cleans staged files', async t => {
  const dir = await directory(t), path = join(dir, '导图.svg'); await writeFile(path, 'old export');
  const result = await exportMindmap(null, data, { format: 'svg' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path }), showMessageBox: async () => ({ response: 0 }) } });
  assert.equal(result.canceled, false);
  assert.ok((await readFile(path, 'utf8')).startsWith('<svg'));
  assert.deepEqual(await readdir(dir), ['导图.svg']);
});

test('chapter names cannot escape the selected folder and duplicate titles stay distinct', () => {
  const paths = exportFilePaths(join(process.cwd(), 'lesson.svg'), 'svg', [{ title: '../../CON' }, { title: '../../CON' }]);
  assert.equal(new Set(paths).size, 2);
  assert.ok(paths.every(path => dirname(path) === process.cwd()));
  assert.ok(paths.every(path => path.endsWith('.svg')));
});

test('large raster exports stay within pixel and edge budgets while retaining aspect ratio', () => {
  for (const dimensions of [[200000, 3000], [100000, 100000], [1920, 1200]]) {
    const size = rasterDimensions(...dimensions);
    assert.ok(size.width * size.height <= 16000000);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(Math.abs(size.width / size.height / (dimensions[0] / dimensions[1]) - 1) < .02);
  }
});
