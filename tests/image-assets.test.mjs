import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const assets = await import('../src/image-assets.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const item = (bytes = png, name = '截图.png', type = 'image/png') => ({ name, type, bytes });
async function fixture(t, options) {
  assert.equal(typeof assets.createImageAssetStore, 'function', 'the durable image asset store must exist');
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.image-assets-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: assets.createImageAssetStore(path.join(directory, 'profile'), options) };
}

test('saved documents import supported image signatures regardless of claimed MIME and suffix', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: path.join(directory, '我的 笔记.md') };
  const images = await store.importImages(record, [item(png, 'one.txt', 'text/plain'), item(jpeg, 'two.png'), item(gif, 'three.webp'), item(webp, 'four.gif')]);
  assert.deepEqual(images.map(image => path.extname(image.src)), ['.png', '.jpg', '.gif', '.webp']);
  assert.deepEqual(images.map(image => image.alt), ['one', 'two', 'three', 'four']);
  for (let index = 0; index < images.length; index++) {
    assert.match(images[index].src, /^%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0\.assets\//);
    assert.deepEqual(await fs.readFile(path.resolve(directory, decodeURIComponent(images[index].src))), [png, jpeg, gif, webp][index]);
  }
});

test('all image limits and signatures are checked before writing any member of a batch', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: path.join(directory, 'note.md') };
  const huge = Buffer.alloc(20 * 1024 * 1024 + 1); png.copy(huge);
  const large = Buffer.alloc(18 * 1024 * 1024); png.copy(large);
  for (const items of [[], Array.from({ length: 11 }, () => item()), [item(), item(Buffer.from('not an image'))], [item(huge)], [item(large), item(large), item(large)], [{ name: 'x.png', type: 'image/png', bytes: [1, 2] }]]) {
    await assert.rejects(store.importImages(record, items), /图片/);
    assert.equal((await fs.readdir(directory)).includes('note.assets'), false);
  }
});

test('pathless image tokens survive a new store instance and stay scoped to their document', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: '../../not-a-directory', path: null };
  const [image] = await store.importImages(record, [item()]);
  assert.match(image.src, /^md-draft-image:[a-f0-9-]{36}\.png$/);
  const restored = assets.createImageAssetStore(path.join(directory, 'profile'));
  const filename = await restored.resolveDraft(record.id, image.src);
  assert.ok(filename.startsWith(path.join(directory, 'profile', 'image-drafts') + path.sep));
  assert.deepEqual(await fs.readFile(filename), png);
  await assert.rejects(restored.resolveDraft('another-document', image.src));
  for (const source of ['md-draft-image:../../other.png', 'md-draft-image:%2e%2e.png', 'file:///secret.png']) {
    await assert.rejects(restored.resolveDraft(record.id, source), /图片/);
  }
});

test('a failed second image write rolls back only files created by that batch', async t => {
  let writes = 0;
  const fsApi = { ...fs, async open(filename, flags, ...rest) {
    if (flags === 'wx' && ++writes === 2) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return fs.open(filename, flags, ...rest);
  } };
  const { directory, store } = await fixture(t, { fsApi });
  const destination = path.join(directory, 'note.assets'); await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'existing.png'), png);
  await assert.rejects(store.importImages({ id: randomUUID(), path: path.join(directory, 'note.md') }, [item(), item()]), /denied/);
  assert.deepEqual(await fs.readdir(destination), ['existing.png']);
  assert.deepEqual(await fs.readFile(path.join(destination, 'existing.png')), png);
});

test('asset name collisions never overwrite existing files', async t => {
  const collision = '11111111-1111-4111-8111-111111111111';
  let calls = 0;
  const { directory, store } = await fixture(t, { randomUUIDImpl: () => ++calls === 1 ? collision : randomUUID() });
  const destination = path.join(directory, 'note.assets'); await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, collision + '.png'), 'keep existing');
  const [image] = await store.importImages({ id: randomUUID(), path: path.join(directory, 'note.md') }, [item()]);
  assert.notEqual(path.basename(image.src), collision + '.png');
  assert.equal(await fs.readFile(path.join(destination, collision + '.png'), 'utf8'), 'keep existing');
});

test('saving drafts materializes only real image references and retains originals for undo and recovery', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: null };
  const [used, unused] = await store.importImages(record, [item(), item(gif, 'unused.gif')]);
  const example = `![same](${used.src})`;
  const markdown = `# Draft\r\n\r\n\`\`\`md\r\n${example}\r\n\`\`\`\r\n\r\n${example}\r\n\r\n![ref][image]\r\n\r\n[image]: <${used.src}> "caption"\r\n`;
  const result = await store.materialize(record, markdown, path.join(directory, 'saved.md'));
  assert.equal(result.imageReplacements.length, 1);
  const [{ from, to }] = result.imageReplacements;
  assert.equal(from, used.src); assert.match(to, /^saved\.assets\/[a-f0-9-]+\.png$/);
  assert.ok(result.content.includes(`\`\`\`md\r\n${example}\r\n\`\`\``));
  assert.ok(result.content.includes(`![same](${to})`));
  assert.ok(result.content.includes(`[image]: <${to}> "caption"`));
  assert.equal((await fs.readdir(path.join(directory, 'saved.assets'))).length, 1);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, used.src)), png);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, unused.src)), gif);
});

test('missing draft references abort materialization before publishing any destination assets', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: null };
  const [image] = await store.importImages(record, [item()]);
  await assert.rejects(store.materialize(record, `![first](${image.src})\n![missing](md-draft-image:22222222-2222-4222-8222-222222222222.png)`, path.join(directory, 'saved.md')));
  assert.equal((await fs.readdir(directory)).includes('saved.assets'), false);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
});

test('discard removes one draft cache without touching saved assets or another document', async t => {
  const { directory, store } = await fixture(t);
  const first = { id: randomUUID(), path: null }, second = { id: randomUUID(), path: null };
  const [a] = await store.importImages(first, [item()]); const [b] = await store.importImages(second, [item()]);
  const saved = await store.materialize(first, `![a](${a.src})`, path.join(directory, 'saved.md'));
  await store.discard(first.id); await store.discard(first.id);
  await assert.rejects(store.resolveDraft(first.id, a.src));
  assert.deepEqual(await fs.readFile(await store.resolveDraft(second.id, b.src)), png);
  assert.deepEqual(await fs.readFile(path.join(directory, decodeURIComponent(saved.imageReplacements[0].to))), png);
});

test('materialized destinations encode parentheses in document-derived asset directories', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: null };
  const [image] = await store.importImages(record, [item()]);
  const result = await store.materialize(record, `![shot](${image.src})`, path.join(directory, 'note) (copy.md'));
  assert.match(result.imageReplacements[0].to, /^note%29%20%28copy\.assets\//);
  assert.deepEqual(await fs.readFile(path.join(directory, decodeURIComponent(result.imageReplacements[0].to))), png);
});

test('unrewritten semantic draft references abort saving and roll back copied assets without removing the cache', async t => {
  const { directory, store } = await fixture(t);
  const record = { id: randomUUID(), path: null };
  const [image] = await store.importImages(record, [item()]);
  // Marked accepts a form-feed before the destination; a missed source-range
  // match must fail safely instead of saving a link that dies on tab close.
  const content = `![shot](\f${image.src})`;
  await assert.rejects(store.materialize(record, content, path.join(directory, 'saved.md')), /暂存图片/);
  assert.deepEqual(await fs.readdir(path.join(directory, 'saved.assets')), []);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
});
