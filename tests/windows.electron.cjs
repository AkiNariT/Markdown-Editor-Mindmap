const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const running = new Set(), children = new Set();
const executablePath = process.env.MOYE_EXE || require('electron');
const launchPrefix = process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')];
if (process.env.MOYE_DEVICE_SCALE) launchPrefix.push('--force-device-scale-factor=' + Number(process.env.MOYE_DEVICE_SCALE));
const sleep = duration => new Promise(resolve => setTimeout(resolve, duration));
async function until(read, accept, name) {
  const deadline = Date.now() + 15000; let last;
  while (Date.now() < deadline) { try { last = await read(); if (accept(last)) return last; } catch (error) { last = error.message; } await sleep(50); }
  throw new Error(name + ': ' + JSON.stringify(last));
}
const ready = page => page.evaluate(() => window.moye.ready());
async function windowSaved(profile, accept) { return until(async () => JSON.parse(await readFile(path.join(profile, 'window-state.json'), 'utf8')), accept, 'window placement persistence'); }
async function launch(profile, files = []) {
  const app = await electron.launch({ executablePath, args: [...launchPrefix, ...files, '--user-data-dir=' + profile], timeout: 30000 });
  const item = { app, profile, page: await app.firstWindow(), errors: [] }; running.add(item);
  item.page.setDefaultTimeout(15000); item.page.on('pageerror', error => item.errors.push(error.message));
  await item.page.waitForSelector('[role=tab]');
  await item.page.waitForFunction(() => !document.querySelector('#mode').disabled);
  await app.evaluate(({ dialog }) => { globalThis.windowsErrors = []; dialog.showErrorBox = (_title, message) => globalThis.windowsErrors.push(message); dialog.showMessageBox = async () => ({ response: 1 }); });
  return item;
}
async function close(item) {
  const closed = item.page.waitForEvent('close');
  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed; await item.app.close().catch(() => {}); running.delete(item); assert.deepEqual(item.errors, []);
}
async function second(profile, files, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...launchPrefix, ...files, '--user-data-dir=' + profile], { cwd, windowsHide: true, stdio: 'ignore' }); children.add(child);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Only the test secondary process failed to exit')); }, 15000);
    child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('exit', code => { clearTimeout(timer); children.delete(child); code === 0 ? resolve() : reject(new Error('secondary exit ' + code)); });
  });
}
async function documents(item, count) { return until(() => ready(item.page), value => value.documents?.length === count, 'queued document count ' + count); }
const sameBounds = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 1);

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'windows-')), profile = path.join(directory, 'profile'); await mkdir(profile);
  const a = path.join(directory, '初始 中文 空格.md'), b = path.join(directory, '第二份.markdown'), map = path.join(directory, '普通 脑图.mdmap');
  const later = path.join(directory, '稍后 打开.md'), later2 = path.join(directory, '稍后 第二份.markdown'), checkpointFile = path.join(directory, '备份期间.md'), startupFile = path.join(directory, '界面重载期间.md');
  for (const file of [a, b, later, later2, checkpointFile, startupFile]) await writeFile(file, '# ' + path.basename(file) + '\n\n保留中文和空格路径。\n');
  await writeFile(map, JSON.stringify({ format: 'md-mindmap', version: 1, root: 'root', nodes: [{ id: 'root', parent: null, text: '启动导图', file: null, collapsed: false }] }));
  await writeFile(path.join(profile, 'window-state.json'), JSON.stringify({ version: 1, bounds: { x: 40000, y: -30000, width: 1900, height: 1400 }, maximized: false }));
  let item = await launch(profile, [a, b, map, a]);
  let state = await documents(item, 3); assert.deepEqual(new Set(state.documents.map(value => value.path)), new Set([a, b, map]));
  const aId = state.documents.find(value => value.path === a).id;
  assert.equal(state.id, aId, 'duplicate command-line file activates its existing tab');
  assert.equal('library' in state, false); assert.equal('libraryVisible' in state, false);
  assert.equal(await item.page.locator('#library-mount,#library-toggle,.library-panel').count(), 0);
  assert.deepEqual(await item.page.evaluate(() => ['libraryState', 'chooseFolder', 'refreshLibrary', 'searchLibrary', 'openLibraryFile'].filter(name => name in window.moye)), []);
  const screenState = await item.app.evaluate(({ BrowserWindow, screen }) => { const window = BrowserWindow.getAllWindows()[0]; return { bounds: window.getBounds(), minimum: window.getMinimumSize(), area: screen.getDisplayMatching(window.getBounds()).workArea, version: process.getSystemVersion() }; });
  assert.ok(screenState.bounds.x >= screenState.area.x && screenState.bounds.y >= screenState.area.y);
  assert.ok(screenState.bounds.x + screenState.bounds.width <= screenState.area.x + screenState.area.width + 1);
  assert.ok(screenState.bounds.y + screenState.bounds.height <= screenState.area.y + screenState.area.height + 1);
  assert.ok(screenState.minimum[0] <= screenState.area.width && screenState.minimum[1] <= screenState.area.height);

  const normal = await item.app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0], area = screen.getDisplayMatching(window.getBounds()).workArea;
    const [minWidth,minHeight] = window.getMinimumSize(), width = Math.min(area.width,Math.max(minWidth,Math.min(900,area.width-70))), height = Math.min(area.height,Math.max(minHeight,Math.min(620,area.height-60)));
    window.setBounds({ x: Math.round(area.x + Math.min(55,(area.width-width)/2)), y: Math.round(area.y + Math.min(45,(area.height-height)/2)), width, height });
    return window.getNormalBounds();
  });
  await windowSaved(profile, value => sameBounds(value.bounds, normal) && value.maximized === false);
  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await windowSaved(profile, value => value.maximized === true && sameBounds(value.bounds, normal));
  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await sleep(250); assert.equal((await windowSaved(profile, () => true)).maximized, true);
  await close(item); item = await launch(profile);
  const restored = await item.app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; return { bounds: window.getNormalBounds(), maximized: window.isMaximized(), minimized: window.isMinimized() }; });
  assert.ok(sameBounds(restored.bounds, normal), JSON.stringify({normal,restored,stored:JSON.parse(await readFile(path.join(profile,'window-state.json'),'utf8'))})); assert.equal(restored.maximized, true); assert.equal(restored.minimized, false);
  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  console.log('PASS window work-area correction, DIP bounds, maximum restoration, and no minimized restart; host=' + screenState.version);

  const markdownDraft = '# 未保存的中文源码\n\n外部打开请求不能替换此草稿。\n';
  await item.page.getByRole('button', { name: '源码', exact: true }).click();
  await item.page.getByRole('button', { name: '编辑', exact: true }).click();
  await item.page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).fill(markdownDraft);
  const mapId = (await ready(item.page)).documents.find(value => value.path === map).id;
  await item.page.evaluate(id => window.moye.activateTab(id), mapId);
  await item.page.getByRole('button', { name: '编辑', exact: true }).click();
  const mapInput = item.page.getByRole('textbox', { name: '节点文字', exact: true });
  await mapInput.fill('未保存的导图主题'); await mapInput.blur();
  await until(async () => JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')), value => value.documents.some(document => document.id === mapId && document.draft?.includes('未保存的导图主题')), 'map draft checkpoint');
  await item.page.evaluate(id => window.moye.activateTab(id), aId);
  await item.page.waitForFunction(() => !document.querySelector('#mode').disabled);

  // Use the real singleton transport while a native file dialog keeps main busy.
  await item.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => new Promise(resolve => { globalThis.windowsReleaseDialog = resolve; }); });
  await item.page.evaluate(() => { window.windowsOpen = window.moye.open(); });
  await until(() => item.app.evaluate(() => typeof globalThis.windowsReleaseDialog), value => value === 'function', 'held open dialog');
  await second(profile, [path.basename(later), path.basename(later2), path.basename(a)], directory);
  assert.equal((await ready(item.page)).documents.length, 3, 'external requests wait during a dialog');
  await item.app.evaluate(() => globalThis.windowsReleaseDialog({ canceled: true, filePaths: [] }));
  state = await until(() => ready(item.page), value => value.documents?.length === 5 && value.id === aId, 'complete queued files and final duplicate activation');
  assert.equal(state.documents.filter(value => value.path === a).length, 1);
  assert.equal(await item.page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).inputValue(), markdownDraft);
  assert.ok(state.documents.find(value => value.id === mapId).recovery.draft.includes('未保存的导图主题'));
  console.log('PASS second-instance requests during busy dialog, multiple Unicode relative paths, existing-tab reuse');

  // Hold a real sync to make the checkpoint race deterministic in this test's
  // process only. A different process or profile is never inspected or closed.
  await sleep(250);
  await item.app.evaluate(async (_electron, profile) => {
    const fs = process.getBuiltinModule('node:fs').promises, path = process.getBuiltinModule('node:path');
    const probe = await fs.open(path.join(profile, 'probe'), 'w'), prototype = Object.getPrototypeOf(probe), original = prototype.sync;
    await probe.close(); await fs.unlink(path.join(profile, 'probe'));
    globalThis.windowsHoldSync = true; globalThis.windowsSyncHeld = false;
    prototype.sync = async function (...args) { if (globalThis.windowsHoldSync) { globalThis.windowsHoldSync = false; globalThis.windowsSyncHeld = true; await new Promise(resolve => { globalThis.windowsReleaseSync = () => { prototype.sync = original; resolve(); }; }); } return original.apply(this, args); };
  }, profile);
  await item.page.evaluate(() => { window.windowsCheckpoint = window.moye.checkpoint({ documents: [] }); });
  await until(() => item.app.evaluate(() => globalThis.windowsSyncHeld), Boolean, 'held checkpoint');
  await second(profile, [checkpointFile, later], directory); assert.equal((await ready(item.page)).documents.length, 5);
  await item.app.evaluate(() => globalThis.windowsReleaseSync());
  state = await until(() => ready(item.page), value => value.documents?.length === 6 && value.documents.find(document => document.id === value.id)?.path === later, 'complete checkpoint queue with final activation');
  assert.ok(state.documents.some(value => value.path === checkpointFile));
  console.log('PASS second-instance requests survive a pending durable checkpoint');

  // Gate the real renderer handshake for a reload, then exercise the singleton
  // transport while the renderer cannot yet receive new document events.
  await item.app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('moye:session-ready');
    ipcMain._invokeHandlers.set('moye:session-ready', async (...args) => {
      await new Promise(resolve => { globalThis.windowsReleaseReady = resolve; });
      ipcMain._invokeHandlers.set('moye:session-ready', original); return original(...args);
    });
  });
  await item.page.reload();
  await until(() => item.app.evaluate(() => typeof globalThis.windowsReleaseReady), value => value === 'function', 'renderer handshake gate');
  await second(profile, [startupFile], directory); assert.equal((await ready(item.page)).documents.length, 6);
  await item.app.evaluate(() => globalThis.windowsReleaseReady());
  state = await documents(item, 7); assert.ok(state.documents.some(value => value.path === startupFile));
  await item.page.waitForFunction(name => document.querySelector('#document-name').textContent === name, path.basename(startupFile));
  assert.deepEqual(await item.app.evaluate(() => globalThis.windowsErrors), []);

  const small = await item.app.evaluate(({ screen, BrowserWindow }) => {
    const getAll = screen.getAllDisplays, getPrimary = screen.getPrimaryDisplay;
    const fake = { ...getPrimary(), workArea: { x: 0, y: 0, width: 640, height: 420 } };
    globalThis.windowsRestoreScreen = () => { screen.getAllDisplays = getAll; screen.getPrimaryDisplay = getPrimary; screen.emit('display-metrics-changed', {}, getPrimary(), ['workArea']); };
    screen.getAllDisplays = () => [fake]; screen.getPrimaryDisplay = () => fake;
    screen.emit('display-metrics-changed', {}, fake, ['workArea']);
    const window = BrowserWindow.getAllWindows()[0]; return { bounds: window.getNormalBounds(), minimum: window.getMinimumSize() };
  });
  assert.ok(small.bounds.x >= 0 && small.bounds.y >= 0 && small.bounds.x + small.bounds.width <= 640 && small.bounds.y + small.bounds.height <= 420, 'simulated 640×420 work area must contain the actual native window: ' + JSON.stringify(small));
  assert.ok(small.minimum[0] <= 640 && small.minimum[1] <= 420);
  await item.app.evaluate(() => globalThis.windowsRestoreScreen());
  console.log('PASS simulated 640×420 work-area correction against actual native bounds');
  await close(item);
  console.log('WINDOWS PASS: renderer readiness queue, initial and second-instance multi-file opening, no file library, window placement and maximize persistence');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill();
  for (const item of running) { await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy()).catch(() => {}); await item.app.close().catch(() => {}); }
});
