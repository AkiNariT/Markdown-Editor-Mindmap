import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const module = await import('../src/open-queue.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
function queue(options) { assert.equal(typeof module.createOpenQueue, 'function', 'external file queue must exist'); return module.createOpenQueue(options); }

test('command-line parsing preserves Chinese and spaces, resolves sender cwd, and excludes flags', () => {
  assert.equal(typeof module.parseOpenArguments, 'function');
  const cwd = path.resolve('fixture');
  assert.deepEqual(module.parseOpenArguments(['MD.exe', '--user-data-dir=bad.md', '中文 空格.md', '第二份.markdown', '地图.mdmap', 'ignore.txt', '--', '-named.md'], cwd), [path.join(cwd, '中文 空格.md'), path.join(cwd, '第二份.markdown'), path.join(cwd, '地图.mdmap'), path.join(cwd, '-named.md')]);
});
test('startup and busy requests remain queued until the host becomes ready', async () => {
  let ready = false; const opened = [];
  const pending = queue({ open: async file => opened.push(file), canRun: () => ready });
  pending.enqueue(['startup.md', 'second 中文.md']); await pending.drain();
  assert.deepEqual(opened, []); assert.equal(pending.size, 2);
  ready = true; await pending.drain(); assert.deepEqual(opened, ['startup.md', 'second 中文.md']); assert.equal(pending.size, 0);
});
test('requests appended while opening stay ordered and never run in parallel', async () => {
  let release, count = 0, maximum = 0; const opened = [];
  const hold = new Promise(resolve => { release = resolve; });
  const pending = queue({ canRun: () => true, open: async file => { count++; maximum = Math.max(maximum, count); opened.push(file); if (file === 'first') await hold; count--; } });
  pending.enqueue(['first']); const initial = pending.drain(); await Promise.resolve();
  pending.enqueue(['second', 'first']); release(); await initial; await pending.drain();
  assert.deepEqual(opened, ['first', 'second', 'first']); assert.equal(maximum, 1);
});
test('one unreadable path reports its error and does not drop the remaining files', async () => {
  const opened = [], failures = [];
  const pending = queue({ canRun: () => true, open: async file => { if (file === 'bad') throw new Error('unreadable'); opened.push(file); }, onError: (error, file) => failures.push([file, error.message]) });
  pending.enqueue(['bad', 'good']); await pending.drain();
  assert.deepEqual(opened, ['good']); assert.deepEqual(failures, [['bad', 'unreadable']]);
});
test('a newly busy host pauses between files without dropping its tail', async () => {
  let ready = true; const opened = [];
  const pending = queue({ canRun: () => ready, open: async file => { opened.push(file); ready = false; } });
  pending.enqueue(['one', 'two']); await pending.drain(); assert.deepEqual(opened, ['one']); assert.equal(pending.size, 1);
  ready = true; await pending.drain(); assert.deepEqual(opened, ['one', 'two']);
});

test('a request arriving between loop completion and cleanup starts another drain', async () => {
  const opened = []; let pending;
  pending = queue({ canRun: () => true, open: async file => {
    opened.push(file);
    if (file === 'first') Promise.resolve().then(() => Promise.resolve().then(() => pending.enqueue(['second'])));
  } });
  pending.enqueue(['first']); await pending.drain();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['first', 'second']); assert.equal(pending.size, 0);
});
