import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { prepareShareBundle, writeShareBundle } from '../src/share-bundle.mjs';
import { createMindmap, parseMindmap } from '../src/mindmap.mjs';
import { imageDestinations } from '../src/images.mjs';
import { markdownToMindmap, resolveHeadingLink } from '../src/mindmap-outline.mjs';
import { marked } from 'marked';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl18YoAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(process.cwd(), '.share-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return base;
}

// Read the ordinary ZIP central directory and independently inflate its contents.
async function readZip(target) {
  const zip = await fs.readFile(target), end = zip.lastIndexOf(Buffer.from('504b0506', 'hex'));
  assert.ok(end >= 0);
  const entries = new Map();
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const nameSize = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameSize);
    const local = zip.readUInt32LE(offset + 42), compression = zip.readUInt16LE(offset + 10);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const content = zip.subarray(start, start + zip.readUInt32LE(offset + 20));
    assert.ok(!entries.has(name) && !name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'));
    entries.set(name, compression === 8 ? inflateRawSync(content) : Buffer.from(content));
    offset += 46 + nameSize + extra + comment;
  }
  return entries;
}

test('copied heading links still resolve after image paths change, including a uniquely relocated live section', async t => {
  const base = await fixture(t), note = path.join(base, 'book.md'), file = path.join(base, 'map.mdmap');
  const original = '# Book\n\n## Details\n\nOther\n\n## Details\n\n![diagram](image.png)\n\n## Twin\nSame\n## Twin\nSame\n';
  const live = original.replace('## Details', '## Details\n\nNew sibling\n\n## Details');
  const map = markdownToMindmap(original, { file: note });
  const second = map.nodes[2], twin = map.nodes[4];
  const legacy = { ...second, id: 'legacy' }; delete legacy.headingAnchor;
  map.nodes.push(legacy, ...Array.from({ length: 24 }, (_, i) => ({ ...second, id: 'another-' + i })));
  second.headingAnchor.custom = 'anchor metadata';
  second.headingPath.at(-1).custom = 'path metadata';
  const mapText = JSON.stringify(map);
  await fs.writeFile(file, mapText); await fs.writeFile(note, original); await fs.writeFile(path.join(base, 'image.png'), png);
  assert.equal(resolveHeadingLink(live, second).target.path.at(-1).occurrence, 3);
  assert.equal(resolveHeadingLink(live, twin).target, undefined);
  const lexer = t.mock.method(marked, 'lexer');
  let reads = 0;
  const plan = await prepareShareBundle({ type: 'mindmap', path: file, content: mapText }, {
    getDocument: async () => { reads++; return { content: live }; },
  });
  const headingParses = lexer.mock.calls.filter(call => call.arguments[1]?.tokenizer).length;
  assert.equal(reads, 1);
  assert.deepEqual(plan.warnings, []);
  const archive = path.join(base, 'share.zip'); await writeShareBundle(plan, archive);
  const packed = await readZip(archive), copied = JSON.parse(packed.get('map.mdmap'));
  const target = copied.nodes.find(n => n.id === second.id), markdown = packed.get(target.file).toString();
  assert.ok(markdown.includes('![diagram](../assets/image.png)'));
  for (const node of [target, copied.nodes.at(-1)]) {
    const resolved = resolveHeadingLink(markdown, node).target;
    assert.ok(resolved, 'recipient can open the original image section without making a choice');
    assert.equal(resolved.path.at(-1).occurrence, 3);
    assert.equal(node.headingPath.at(-1).occurrence, 3);
    assert.equal(node.headingAnchor.document, resolved.anchor.document);
  }
  assert.equal(target.headingAnchor.custom, 'anchor metadata');
  assert.equal(target.headingPath.at(-1).custom, 'path metadata');
  const copiedTwin = copied.nodes.find(n => n.id === twin.id), copiedLegacy = copied.nodes.find(n => n.id === legacy.id);
  assert.deepEqual(copiedTwin.headingAnchor, twin.headingAnchor);
  assert.equal(copiedLegacy.headingAnchor, undefined);
  for (const node of [copiedTwin, copiedLegacy]) assert.equal(resolveHeadingLink(markdown, node).target, undefined);
  assert.equal(headingParses, 2, 'parse the original and copied outline once per distinct Markdown file');
  assert.equal(await fs.readFile(file, 'utf8'), mapText); assert.equal(await fs.readFile(note, 'utf8'), original);
});

test('rewritten image paths never turn an ambiguous or deleted heading into a silent match', async t => {
  const base = await fixture(t), note = path.join(base, 'book.md'), mapFile = path.join(base, 'map.mdmap');
  const before = '# Book\n## Details\n![diagram](../assets/one.png)\n## Details\n![diagram](../assets/two.png)\n';
  const swapped = '# Book\n## Details\n![diagram](two.png)\n## Details\n![diagram](one.png)\n';
  const oneRemaining = '# Book\n## Details\n![diagram](one.png)\n';
  const source = markdownToMindmap(before, { file: note });
  await fs.writeFile(path.join(base, 'one.png'), png); await fs.writeFile(path.join(base, 'two.png'), png);
  for (const live of [swapped, oneRemaining]) {
    const plan = await prepareShareBundle({ type: 'mindmap', path: mapFile, content: JSON.stringify(source) }, {
      getDocument: async () => ({ content: live }),
    });
    const mapText = plan.entries.find(e => e.name === plan.rootName).content;
    const copied = parseMindmap(mapText), first = copied.nodes[1], second = copied.nodes[2];
    const markdown = plan.entries.find(e => e.name === first.file).content;
    for (const [index, node] of [first, second].entries()) {
      assert.equal(resolveHeadingLink(live, source.nodes[index + 1]).target, undefined);
      assert.equal(resolveHeadingLink(markdown, node).target, undefined, 'packaging must not select a different sibling');
    }
    if (live === swapped) assert.equal(second.headingAnchor, undefined, 'the later occurrence can keep asking with its legacy path alone');
    const editedAgain = '# Book\n## Details\n![diagram](../assets/one.png)\n\n## Other\nUnrelated edit\n';
    assert.equal(resolveHeadingLink(editedAgain, first).target, undefined);
    const reexport = await prepareShareBundle({ type: 'mindmap', path: mapFile, content: mapText }, {
      getDocument: async () => ({ content: editedAgain }),
    });
    const newMap = parseMindmap(reexport.entries.find(e => e.name === reexport.rootName).content);
    const newNote = reexport.entries.find(e => e.name === newMap.nodes[1].file).content;
    const reopened = resolveHeadingLink(newNote, newMap.nodes[1]);
    assert.equal(reopened.target, undefined);
    const chosen = reopened.candidates[0];
    assert.equal(resolveHeadingLink(newNote, { headingPath: chosen.path, headingAnchor: chosen.anchor }).target?.line, 2);
  }
});

test('packages the active Markdown, its referenced images and draft images without touching source or remote URLs', async t => {
  const base = await fixture(t), file = path.join(base, '文章.md'), cache = path.join(base, 'cache.png');
  await fs.writeFile(file, 'saved file'); await fs.writeFile(cache, png); await fs.writeFile(path.join(base, '图片(1).png'), png);
  const uri = 'md-draft-image:test.png', front = '\ufeff---\r\ntitle: "![not an image](private.png)"\r\n---\r\n\r\n';
  const body = '![first][A]\r\n\r\n[A]: <图片(1).png> "title"\r\n\r\n[![draft](' + uri + ')](https://example.org)\r\n\r\n' +
    '![remote](https://example.org/a.png)\r\n\r\n![missing](absent.png)\r\n\r\n`![example](' + uri + ')`\r\n';
  const plan = await prepareShareBundle({ id: 'active', type: 'markdown', path: file, content: front + body }, {
    resolveDraftImage: async (id, source) => { assert.equal(id, 'active'); assert.equal(source, uri); return cache; },
  });
  assert.deepEqual(plan.warnings.map(w => [w.kind, w.reference]).sort(), [['missing', 'absent.png'], ['remote', 'https://example.org/a.png']]);
  const archive = path.join(base, 'share.zip');
  const result = await writeShareBundle(plan, archive);
  const entries = await readZip(archive), text = entries.get(plan.rootName).toString();
  assert.equal(result.entryCount, 3); assert.equal(entries.size, 3);
  assert.ok(text.startsWith(front)); assert.ok(text.includes('`![example](' + uri + ')`\r\n'));
  assert.ok(text.includes('"title"')); assert.ok(text.includes('](https://example.org)')); assert.ok(!text.replaceAll('\r\n', '').includes('\n'));
  const images = imageDestinations(text.slice(front.length)); assert.equal(images.length, 4);
  assert.deepEqual(entries.get(decodeURIComponent(images[0])), png); assert.deepEqual(entries.get(decodeURIComponent(images[1])), png);
  assert.equal(await fs.readFile(file, 'utf8'), 'saved file');
});

test('map bundles preserve unknown metadata, resolve same-named notes and deduplicate shared pictures and nodes', async t => {
  const base = await fixture(t), root = path.join(base, '图.mdmap');
  await fs.mkdir(path.join(base, 'a')); await fs.mkdir(path.join(base, 'b'));
  const a = path.join(base, 'a', 'note.md'), b = path.join(base, 'b', 'note.md');
  await fs.writeFile(a, 'OLD'); await fs.writeFile(b, 'second\n\n![shared](../shared.png)'); await fs.writeFile(path.join(base, 'shared.png'), png);
  const map = createMindmap(); map.extra = 'keep'; map.nodes[0].file = 'a/note.md';
  map.nodes.push(...[b, 'a/note.md', 'lost/note.md'].map((file, i) => ({ id: 'n' + i, parent: 'root', text: 'node', file, collapsed: false })));
  const plan = await prepareShareBundle({ type: 'mindmap', path: root, content: JSON.stringify(map) }, {
    getDocument: async name => path.normalize(name) === a ? { id: 'A', content: 'LIVE\n\n![shared](../shared.png)' } : null,
  });
  assert.deepEqual(plan.warnings.map(w => w.kind), ['missing']);
  const archive = path.join(base, 'share.zip'); await writeShareBundle(plan, archive);
  const entries = await readZip(archive), text = entries.get(plan.rootName).toString(); assert.ok(!text.includes(base.split('\\').at(-1)));
  assert.equal(JSON.parse(text).extra, 'keep');
  const nodes = parseMindmap(text).nodes;
  assert.equal(nodes[0].file, nodes[2].file); assert.notEqual(nodes[0].file, nodes[1].file); assert.ok(!entries.has(nodes[3].file));
  const notes = nodes.slice(0, 2).map(n => entries.get(n.file).toString());
  assert.match(notes[0], /^LIVE/); assert.match(notes[1], /^second/);
  const images = notes.map((note, i) => path.posix.normalize(path.posix.join(path.posix.dirname(nodes[i].file), decodeURIComponent(imageDestinations(note)[0]))));
  assert.equal(images[0], images[1]); assert.deepEqual(entries.get(images[0]), png); assert.equal(entries.size, 4);
});

test('declining overwrite and failures during ZIP writing keep an existing archive intact', async t => {
  const base = await fixture(t), image = path.join(base, 'photo.png'), archive = path.join(base, 'existing.zip');
  await fs.writeFile(image, png); await fs.writeFile(archive, 'keep');
  const plan = await prepareShareBundle({ type: 'markdown', path: path.join(base, 'x.md'), content: '![x](photo.png)' });
  await assert.rejects(writeShareBundle(plan, archive)); assert.equal(await fs.readFile(archive, 'utf8'), 'keep');
  await fs.unlink(image);
  await assert.rejects(writeShareBundle(plan, archive, { overwrite: true }));
  assert.equal(await fs.readFile(archive, 'utf8'), 'keep'); assert.deepEqual(await fs.readdir(base), ['existing.zip']);
});

test('two unfiled mindmap node drafts keep their current contents, pictures and distinct bindings', async t => {
  const base = await fixture(t), cached = path.join(base, 'cached.png'); await fs.writeFile(cached, png);
  const map = createMindmap();
  map.nodes.push(...['left', 'right', 'empty'].map(id => ({ ...map.nodes[0], id, parent: 'root' })));
  const archive = path.join(base, 'new.zip');
  const plan = await prepareShareBundle({ type: 'mindmap', suggestedName: '../CON.mdmap', content: JSON.stringify(map) }, {
    getNodeDraft: async nodeId => ['left', 'right'].includes(nodeId)
      ? { id: nodeId, suggestedName: '资料.md', content: nodeId + '\n\n![image](md-draft-image:' + nodeId + '.png)' } : null,
    resolveDraftImage: async (id, uri) => { assert.equal(uri, 'md-draft-image:' + id + '.png'); return cached; },
  });
  assert.deepEqual(plan.warnings, []); assert.doesNotMatch(plan.rootName, /^(?:con\.|\.|[/\\])/i);
  await writeShareBundle(plan, archive); const entries = await readZip(archive);
  const nodes = parseMindmap(entries.get(plan.rootName).toString()).nodes;
  assert.equal(nodes[0].file, null); assert.equal(nodes[3].file, null); assert.notEqual(nodes[1].file, nodes[2].file);
  for (const node of nodes.slice(1, 3)) {
    const body = entries.get(node.file).toString(); assert.ok(body.startsWith(node.id));
    const filename = path.posix.join(path.posix.dirname(node.file), decodeURIComponent(imageDestinations(body)[0]));
    assert.deepEqual(entries.get(filename), png);
  }
  assert.equal(entries.size, 4);
});

test('a mapped external document can be supplied from memory; UNC and file-server paths are never read', async t => {
  const base = await fixture(t);
  const foreign = process.platform === 'win32' ? 'Z:/share-test/topic.md' : '/unmounted-share-test/topic.md';
  const url = 'file://example.invalid/share/photo.png';
  const map = createMindmap(); map.nodes[0].file = foreign;
  map.nodes.push({ ...map.nodes[0], id: 'remote', parent: 'root', file: '//example.invalid/share/other.md' });
  const plan = await prepareShareBundle({ type: 'mindmap', path: path.join(base, 'root.mdmap'), content: JSON.stringify(map) }, {
    getDocument: async filename => { assert.equal(filename, path.normalize(foreign)); return { content: 'Editor buffer\n\n![server](' + url + ')' }; },
  });
  assert.deepEqual(plan.warnings.map(w => w.kind), ['remote', 'remote']);
  const target = path.join(base, 'map.zip'); await writeShareBundle(plan, target); const entries = await readZip(target);
  const json = entries.get(plan.rootName).toString(); assert.ok(!json.includes('share-test') && !json.includes('example.invalid'));
  const [local, remote] = parseMindmap(json).nodes;
  assert.equal(entries.has(remote.file), false); assert.equal(entries.get(local.file).toString(), 'Editor buffer\n\n![server](' + url + ')');
});

test('a changed image cannot replace an approved snapshot or an existing destination ZIP', async t => {
  const base = await fixture(t), file = path.join(base, 'image.png'), target = path.join(base, 'map.zip');
  await fs.writeFile(file, png);
  const plan = await prepareShareBundle({ type: 'markdown', path: path.join(base, 'x.md'), content: '![photo](image.png)' });
  await fs.writeFile(file, 'changed'); await fs.writeFile(target, 'original');
  await assert.rejects(writeShareBundle(plan, target, { overwrite: true }), { code: 'SHARE_SOURCE_CHANGED' });
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  const replacement = await prepareShareBundle({ type: 'markdown', suggestedName: 'notes.md', content: 'replacement' });
  await writeShareBundle(replacement, target, { overwrite: true });
  assert.equal((await readZip(target)).get('notes.md').toString(), 'replacement');
});

test('oversized root, live, on-disk and unfiled linked documents identify the affected file before export', async t => {
  const base = await fixture(t), tooLarge = 'x'.repeat(8 * 1024 * 1024 + 1);
  const oversized = name => cause => cause.code === 'SHARE_DOCUMENT_TOO_LARGE' && cause.message.includes(name);
  for (const [type, suggestedName] of [['markdown', 'note.md'], ['mindmap', 'root.mdmap']]) {
    await assert.rejects(prepareShareBundle({ type, suggestedName, content: tooLarge }), oversized(suggestedName));
  }
  const map = createMindmap(), root = { type: 'mindmap', path: path.join(base, 'graph.mdmap') };
  map.nodes[0].file = 'child.md'; root.content = JSON.stringify(map);
  await fs.writeFile(path.join(base, 'child.md'), tooLarge);
  await assert.rejects(prepareShareBundle(root, { getDocument: async () => ({ content: tooLarge }) }), oversized('child.md'));
  await assert.rejects(prepareShareBundle(root), oversized('child.md'));
  map.nodes[0].file = null; root.content = JSON.stringify(map);
  await assert.rejects(prepareShareBundle(root, { getNodeDraft: async () => ({ id: 'scratch', suggestedName: 'draft.md', content: tooLarge }) }), oversized('draft.md'));
});

test('the 8 MiB limit includes rewritten image and map links and counts UTF-8 bytes', async t => {
  const base = await fixture(t), limit = 8 * 1024 * 1024;
  await fs.writeFile(path.join(base, 'p.png'), png);
  const suffix = '\n\`\`\`\n\n![photo](p.png)', prefix = '\`\`\`\n';
  const remaining = limit - Buffer.byteLength(prefix + suffix);
  const content = prefix + '界'.repeat(Math.floor(remaining / 3)) + 'a'.repeat(remaining % 3) + suffix;
  assert.equal(Buffer.byteLength(content), limit);
  await assert.rejects(prepareShareBundle({ type: 'markdown', path: path.join(base, 'after.md'), content }),
    cause => cause.code === 'SHARE_DOCUMENT_TOO_LARGE' && cause.message.includes('after.md'));
  const map = createMindmap(); map.nodes[0].file = 'a.md'; map.extra = '';
  map.extra = 'a'.repeat(limit - Buffer.byteLength(JSON.stringify(map)));
  await fs.writeFile(path.join(base, 'a.md'), 'small');
  await assert.rejects(prepareShareBundle({ type: 'mindmap', path: path.join(base, 'after.mdmap'), content: JSON.stringify(map) }),
    cause => cause.code === 'SHARE_DOCUMENT_TOO_LARGE' && cause.message.includes('after.mdmap'));
});
