import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import * as filesModule from '../src/files.mjs';
import * as documentModule from '../src/document.mjs';
import * as imageModule from '../src/image-assets.mjs';
import * as imagesModule from '../src/images.mjs';
import * as recoveryModule from '../src/recovery.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const mainPath = path.resolve('electron/main.cjs');
const nodeRequire = createRequire(mainPath);
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.main-images-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const electron = { app: { isPackaged: false, getPath: () => directory, setName() {}, disableHardwareAcceleration() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() {}, on() {} }, protocol: { registerSchemesAsPrivileged() {} }, Menu: { setApplicationMenu() {} }, dialog: { showSaveDialog: async () => ({ canceled: true }) } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : nodeRequire(name), process, __dirname: path.dirname(mainPath), console, Buffer, URL, Response, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(await fs.readFile(mainPath, 'utf8') + `
    globalThis.hooks = {
      configure(deps, record) {
        files = deps.files; helpers = deps.helpers; imageHelpers = deps.images; imageAssets = deps.assets; imageAssetStore = deps.store;
        t = value => value; recovery = deps.recovery; recoveryStore = { save: async () => ({ ok: true }) };
        win = { setTitle() {}, webContents: { send: (...args) => deps.events.push(args) } };
        doc = record; documents.set(record.id, record);
      },
      add(record) { documents.set(record.id, record); },
      closeDocument, sessionSnapshot,
      saveFromTab: typeof saveFromTab === 'function' ? saveFromTab : undefined,
      setFiles(value) { files = value; },
      setCloseServices(services) { askCloseState = async () => {}; recoveryStore = services.recoveryStore; saveWindowPlacement = services.saveWindowPlacement || (async () => {}); },
      importImages: typeof importImages === 'function' ? importImages : null,
      prepareWindowClose: typeof prepareWindowClose === 'function' ? prepareWindowClose : null,
      saveDocument,
    };
  `, context, { filename: mainPath });
  const store = imageModule.createImageAssetStore(path.join(directory, 'profile'));
  const record = { id: randomUUID(), imageKey: randomUUID(), path: null, content: '', fingerprint: null, dirty: true, editable: true };
  const events = [];
  context.hooks.configure({ files: filesModule, helpers: documentModule, images: imagesModule, assets: imageModule, recovery: recoveryModule, store, events }, record);
  return { directory, hooks: context.hooks, record, store, electron, events };
}

async function savedTabFiles(t, count = 2) {
  const fx = await fixture(t);
  const tabs = [];
  for (const name of ['A', 'B'].slice(0, count)) {
    const filename = path.join(fx.directory, name + '.md');
    await fs.writeFile(filename, name + ' original\r\n');
    const tab = name === 'A' ? fx.record : { id: randomUUID() };
    Object.assign(tab, await filesModule.readDocument(filename), { dirty: false, fileKey: (await fs.realpath(filename)).toLowerCase() });
    tabs.push(tab);
    if (name === 'B') fx.hooks.add(tab);
  }
  return { ...fx, tabs };
}

test('a failed close keeps the tab active and a subsequent save writes only its own file', async t => {
  for (const failedFile of ['session.backup.json', 'session.json']) await t.test(failedFile, async t => {
    const { directory, tabs: [a, b], hooks, events } = await savedTabFiles(t);
    const profile = path.join(directory, 'profile');
    const store = recoveryModule.createRecoveryStore(profile);
    await store.save(hooks.sessionSnapshot());
    let fail = true;
    const fault = recoveryModule.createRecoveryStore(profile, { renameFile: async (from, to) => {
      if (fail && path.basename(to) === failedFile) throw Object.assign(new Error('disk-full'), { code: 'ENOSPC' });
      await fs.rename(from, to);
    } });
    hooks.setCloseServices({ recoveryStore: fault });
    await assert.rejects(hooks.closeDocument(a.id), { code: 'ENOSPC' });
    assert.equal(hooks.sessionSnapshot().activeId, a.id);
    assert.deepEqual(Array.from(hooks.sessionSnapshot().documents, tab => tab.id), [a.id, b.id]);
    assert.deepEqual(events, []);
    const restored = (await store.load()).session;
    assert.equal(restored.activeId, a.id);
    assert.deepEqual(restored.documents.map(tab => tab.id), [a.id, b.id]);
    fail = false;
    await hooks.saveFromTab(a.id, 'A edited', false, true);
    assert.equal(await fs.readFile(a.path, 'utf8'), 'A edited');
    assert.equal(await fs.readFile(b.path, 'utf8'), 'B original\r\n');
    assert.equal((await hooks.closeDocument(a.id)).ok, true);
    assert.equal(hooks.sessionSnapshot().activeId, b.id);
    for (const name of ['session.json', 'session.backup.json']) {
      const snapshot = JSON.parse(await fs.readFile(path.join(profile, name), 'utf8'));
      assert.equal(snapshot.activeId, b.id);
      assert.deepEqual(snapshot.documents.map(tab => tab.id), [b.id]);
    }
    assert.equal(events.filter(([event]) => event === 'moye:closed').length, 1);
  });
});

test('closing a background tab or replacing the last tab only changes visible state after storage succeeds', async t => {
  for (const count of [2, 1]) await t.test(String(count) + ' open', async t => {
    const { directory, tabs, hooks, events } = await savedTabFiles(t, count);
    const profile = path.join(directory, 'blocked');
    await fs.writeFile(profile, 'this file prevents creating the recovery directory');
    hooks.setCloseServices({ recoveryStore: recoveryModule.createRecoveryStore(profile) });
    const target = tabs.at(-1);
    await assert.rejects(hooks.closeDocument(target.id));
    assert.equal(hooks.sessionSnapshot().activeId, tabs[0].id);
    assert.deepEqual(Array.from(hooks.sessionSnapshot().documents, tab => tab.id), tabs.map(tab => tab.id));
    assert.deepEqual(events, []);
    await fs.unlink(profile);
    assert.equal((await hooks.closeDocument(target.id)).ok, true);
    const snapshot = hooks.sessionSnapshot();
    assert.equal(snapshot.documents.length, 1);
    if (count === 2) assert.equal(snapshot.activeId, tabs[0].id);
    else {
      assert.notEqual(snapshot.activeId, target.id);
      assert.equal(snapshot.documents[0].path, null);
      assert.equal(snapshot.documents[0].editable, true);
    }
    for (const name of ['session.json', 'session.backup.json']) {
      const saved = JSON.parse(await fs.readFile(path.join(profile, name), 'utf8'));
      assert.equal(saved.activeId, snapshot.activeId);
      assert.deepEqual(saved.documents.map(d => d.id), [snapshot.activeId]);
    }
  });
});

test('saving rejects missing, closed and background tab IDs before writing any file', async t => {
  const { hooks, tabs: [a, b] } = await savedTabFiles(t);
  for (const id of [undefined, randomUUID(), b.id]) {
    await assert.rejects(hooks.saveFromTab(id, 'wrong contents', false, true));
  }
  assert.equal(await fs.readFile(a.path, 'utf8'), 'A original\r\n');
  assert.equal(await fs.readFile(b.path, 'utf8'), 'B original\r\n');
});

test('preload includes the active tab ID when sending a save request', async () => {
  let api, request;
  vm.runInNewContext(await fs.readFile(path.resolve('electron/preload.cjs'), 'utf8'), { require: () => ({
    contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
    ipcRenderer: { invoke: (...args) => { request = args; } },
  }) });
  api.save('document-id', 'contents', false, true);
  assert.deepEqual(request, ['moye:save', 'document-id', 'contents', false, true]);
});

test('main imports images into the explicit document rather than the active tab', async t => {
  const { directory, hooks, record, store } = await fixture(t);
  assert.equal(typeof hooks.importImages, 'function', 'main must expose the explicit-document import operation');
  const other = { ...record, id: randomUUID(), path: path.join(directory, 'other.md'), inserted: undefined };
  hooks.add(other);
  const result = await hooks.importImages(other.id, [{ name: 'shot.png', type: 'image/png', bytes: png }]);
  assert.equal(result.documentId, other.id);
  assert.match(result.images[0].src, /^other\.assets\//);
  assert.ok(other.inserted.has(result.images[0].src));
  assert.equal(record.inserted, undefined);
  await assert.rejects(hooks.importImages('closed-document', [{ bytes: png }]), /关闭|文档/);
  await assert.rejects(hooks.importImages(other.id, [{ bytes: png }, { bytes: Buffer.from('invalid') }]), /图片/);
  assert.equal(other.inserted.size, 1);
  assert.equal((await fs.readdir(path.join(directory, 'other.assets'))).length, 1);
});

test('first save materializes draft images only after choosing a path and keeps the cache', async t => {
  const { directory, hooks, record, store, electron } = await fixture(t);
  const [image] = await store.importImages(record, [{ name: 'shot.png', bytes: png }]);
  const content = `# Draft\n\n![shot](${image.src})\n`;
  assert.equal((await hooks.saveDocument(content)).canceled, true);
  assert.equal(record.path, null);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.assets')), false);
  const target = path.join(directory, 'saved.md');
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  const result = await hooks.saveDocument(content);
  assert.equal(result.imageReplacements?.length, 1);
  const [{ from, to }] = result.imageReplacements;
  assert.equal(from, image.src);
  assert.equal(await fs.readFile(target, 'utf8'), `# Draft\n\n![shot](${to})\n`);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
  assert.equal(record.path, target);
});

test('preload sends explicit document identity with image imports and the file picker', async () => {
  let api;
  const calls = [];
  vm.runInNewContext(await fs.readFile(path.resolve('electron/preload.cjs'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); } } }) });
  assert.equal(typeof api.importImages, 'function');
  const images = [{ name: 'shot.png', type: 'image/png', bytes: new Uint8Array(png) }];
  api.importImages('document-one', images); api.insertImage('document-two');
  assert.deepEqual(calls[0], ['moye:import-images', 'document-one', images]);
  assert.deepEqual(calls[1], ['moye:image', 'document-two']);
});

test('failed Markdown writes roll back newly materialized assets while retaining the editable draft cache', async t => {
  const { directory, hooks, record, store, electron } = await fixture(t);
  const [image] = await store.importImages(record, [{ name: 'shot.png', bytes: png }]);
  const target = path.join(directory, 'failed.md');
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  hooks.setFiles({ ...filesModule, writeDocument: async () => { throw Object.assign(new Error('disk-full'), { code: 'ENOSPC' }); } });
  await assert.rejects(hooks.saveDocument(`![shot](${image.src})\n`), /disk-full/);
  assert.equal(record.path, null); assert.equal(record.dirty, true);
  assert.deepEqual(await fs.readdir(path.join(directory, 'failed.assets')), []);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
});

test('canceling a later tab close keeps images from an earlier Discard choice', async t => {
  const { directory, hooks, record, store, electron } = await fixture(t);
  assert.equal(typeof hooks.prepareWindowClose, 'function');
  const [image] = await store.importImages(record, [{ bytes: png }]);
  const other = { ...record, id: randomUUID() }; hooks.add(other);
  const [otherImage] = await store.importImages(other, [{ bytes: png }]);
  const choices = [1, 2];
  electron.dialog.showMessageBox = async () => ({ response: choices.shift() });
  hooks.setCloseServices({ recoveryStore: recoveryModule.createRecoveryStore(path.join(directory, 'profile')) });
  assert.equal(await hooks.prepareWindowClose(), false);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(other.id, otherImage.src)), png);
});

test('completed Discard close cleans only discarded caches after both recovery snapshots and window state succeed', async t => {
  const { directory, hooks, record, store, electron } = await fixture(t);
  assert.equal(typeof hooks.prepareWindowClose, 'function');
  const [image] = await store.importImages(record, [{ bytes: png }]);
  const other = { ...record, id: randomUUID(), dirty: false }; hooks.add(other);
  const [otherImage] = await store.importImages(other, [{ bytes: png }]);
  const recoveryStore = recoveryModule.createRecoveryStore(path.join(directory, 'profile'));
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  hooks.setCloseServices({ recoveryStore, saveWindowPlacement: async () => {
    assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
    for (const filename of ['session.json', 'session.backup.json']) {
      const session = JSON.parse(await fs.readFile(path.join(directory, 'profile', filename), 'utf8'));
      assert.equal(session.documents.some(value => value.id === record.id), false);
    }
  } });
  assert.equal(await hooks.prepareWindowClose(), true);
  await assert.rejects(store.resolveDraft(record.id, image.src), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(await store.resolveDraft(other.id, otherImage.src)), png);
});

test('failed primary or fallback recovery writes never remove discarded draft images', async t => {
  for (const failedFile of ['session.json', 'session.backup.json']) await t.test(failedFile, async t => {
    const { directory, hooks, record, store, electron } = await fixture(t);
    assert.equal(typeof hooks.prepareWindowClose, 'function');
    const [image] = await store.importImages(record, [{ bytes: png }]);
    const recoveryStore = recoveryModule.createRecoveryStore(path.join(directory, 'profile'), { renameFile: async (from, to) => {
      if (path.basename(to) === failedFile) throw new Error('recovery-write-failed');
      await fs.rename(from, to);
    } });
    electron.dialog.showMessageBox = async () => ({ response: 1 });
    hooks.setCloseServices({ recoveryStore });
    await assert.rejects(hooks.prepareWindowClose(), /recovery-write-failed/);
    assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
  });
});

test('failure in final window-state saving keeps discarded caches available to the still-open editor', async t => {
  const { directory, hooks, record, store, electron } = await fixture(t);
  assert.equal(typeof hooks.prepareWindowClose, 'function');
  const [image] = await store.importImages(record, [{ bytes: png }]);
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  hooks.setCloseServices({ recoveryStore: recoveryModule.createRecoveryStore(path.join(directory, 'profile')), saveWindowPlacement: async () => { throw new Error('window-write-failed'); } });
  await assert.rejects(hooks.prepareWindowClose(), /window-write-failed/);
  assert.deepEqual(await fs.readFile(await store.resolveDraft(record.id, image.src)), png);
});
