import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs/promises');
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

async function chapterExport(t) {
  const dir = await directory(t);
  const nodes = [...data.nodes, ...['A', 'B'].map(id => ({ id, parent: 'root', text: id, file: null, collapsed: false }))];
  const names = ['lesson-01-总览.svg', 'lesson-02-A.svg', 'lesson-03-B.svg'];
  const paths = names.map(name => join(dir, name));
  const run = () => exportMindmap(null, { ...data, nodes }, { format: 'svg', scope: 'chapters' }, { dialog: {
    showSaveDialog: async () => ({ filePath: join(dir, 'lesson.svg') }), showMessageBox: async () => ({ response: 0 }),
  } });
  return { dir, names, paths, run };
}

test('a locked chapter leaves all existing pages at their original versions', async t => {
  const { dir, names, paths, run } = await chapterExport(t);
  await Promise.all(paths.map((p, i) => writeFile(p, 'old ' + i)));
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === paths[1] || to === paths[1]) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    return rename(from, to);
  });
  await assert.rejects(run(), { code: 'EBUSY' });
  assert.deepEqual(await Promise.all(paths.map(p => readFile(p, 'utf8'))), ['old 0', 'old 1', 'old 2']);
  assert.deepEqual((await readdir(dir)).sort(), names);
});

for (const overwrite of [false, true]) {
  test(`a late filename collision rolls back earlier ${overwrite ? 'replacement and new' : 'new'} pages`, async t => {
    const { dir, names, paths, run } = await chapterExport(t);
    if (overwrite) await writeFile(paths[0], 'old overview');
    const link = fs.link;
    t.mock.method(fs, 'link', async (from, to) => {
      if (to === paths[2]) await writeFile(to, 'from another program', { flag: 'wx' });
      return link(from, to);
    });
    await assert.rejects(run(), { code: 'EEXIST' });
    assert.deepEqual((await readdir(dir)).sort(), overwrite ? [names[0], names[2]] : [names[2]]);
    if (overwrite) assert.equal(await readFile(paths[0], 'utf8'), 'old overview');
    assert.equal(await readFile(paths[2], 'utf8'), 'from another program');
  });
}

test('rollback preserves an external edit to a published page and reports where to recover the original', async t => {
  const { dir, paths, run } = await chapterExport(t);
  await writeFile(paths[0], 'original overview');
  const link = fs.link;
  t.mock.method(fs, 'link', async (from, to) => {
    if (to === paths[2]) {
      await writeFile(paths[0], 'external edit after publication');
      await writeFile(to, 'other writer', { flag: 'wx' });
    }
    return link(from, to);
  });
  let message;
  await assert.rejects(run(), error => { message = error.message; return true; });
  assert.equal(await readFile(paths[0], 'utf8'), 'external edit after publication');
  assert.equal(await readFile(paths[2], 'utf8'), 'other writer');
  await assert.rejects(readFile(paths[1]), { code: 'ENOENT' });
  const folders = (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.equal(folders.length, 1);
  const backup = join(dir, folders[0].name, basename(paths[0]));
  assert.equal(await readFile(backup, 'utf8'), 'original overview');
  assert.ok(message.includes(paths[0]) && message.includes(backup));
});

test('successful mixed replacement publishes every chapter and removes its backups', async t => {
  const { dir, names, paths, run } = await chapterExport(t);
  await writeFile(paths[1], 'old chapter');
  const result = await run();
  assert.deepEqual(result.paths, paths);
  for (const p of paths) assert.match(await readFile(p, 'utf8'), /^<svg/);
  assert.deepEqual((await readdir(dir)).sort(), names);
});

test('rollback restores original contents on a filesystem without hard links', async t => {
  const { dir, names, paths, run } = await chapterExport(t);
  await writeFile(paths[0], 'original');
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('no hard links'), { code: 'ENOTSUP' }); });
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === paths[2]) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return open(file, ...args);
  });
  await assert.rejects(run(), { code: 'ENOSPC' });
  assert.deepEqual(await readdir(dir), [names[0]]);
  assert.equal(await readFile(paths[0], 'utf8'), 'original');
});

test('an overlapping export cannot publish into an in-progress set of pages', async t => {
  const { dir, names, paths, run } = await chapterExport(t);
  const link = fs.link;
  let competing;
  t.mock.method(fs, 'link', async (from, to) => {
    if (to === paths[1] && !competing) {
      competing = run();
      await assert.rejects(competing, /更改|changed/i);
    }
    return link(from, to);
  });
  await run();
  assert.ok(competing);
  assert.deepEqual((await readdir(dir)).sort(), names);
  for (const p of paths) assert.match(await readFile(p, 'utf8'), /^<svg/);
});

test('chapter names cannot escape the selected folder and duplicate titles stay distinct', () => {
  const paths = exportFilePaths(join(process.cwd(), 'lesson.svg'), 'svg', [{ title: '../../CON' }, { title: '../../CON' }]);
  assert.equal(new Set(paths).size, 2);
  assert.ok(paths.every(path => path.startsWith(process.cwd() + '\\') && !path.slice(process.cwd().length + 1).includes('\\')));
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
