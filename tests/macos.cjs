const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');

const execute = promisify(execFile), running = new Set();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let latest;
  while (Date.now() < deadline) {
    try { latest = await read(); if (predicate(latest)) return latest; } catch (error) { latest = error.message; }
    await sleep(50);
  }
  throw new Error(label + ': ' + JSON.stringify(latest));
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function connectInspector(port) {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0], value => value?.webSocketDebuggerUrl, 'Finder-launched main inspector');
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error || message.result?.exceptionDetails) task.reject(new Error(JSON.stringify(message)));
    else task.resolve(message.result?.result?.value);
  });
  return {
    evaluate(expression) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector command timed out')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
    close() { socket.close(); },
  };
}

// LaunchServices delivers the document as a real early open-file event. This
// separate instance has its own profile and is closed before Playwright starts.
async function finderColdStart(appPath, directory) {
  const profile = path.join(directory, 'finder-profile'), file = path.join(directory, 'Finder 冷启动.md');
  await writeFile(file, '# Finder cold start\n');
  const port = await freePort();
  const launcher = spawn('/usr/bin/open', ['-n', '-W', '-a', appPath, file, '--args', '--user-data-dir=' + profile, '--inspect=127.0.0.1:' + port], { stdio: 'ignore' });
  const launcherExit = new Promise((resolve, reject) => { launcher.once('error', reject); launcher.once('exit', code => resolve(code)); });
  let inspector, ownedPid;
  try {
    inspector = await connectInspector(port);
    ownedPid = await inspector.evaluate('process.pid');
    const session = await until(async () => JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')), value => value.documents?.some(document => document.path === file), 'Finder cold-start document');
    assert.equal(session.documents.filter(document => document.path === file).length, 1);
    const info = await inspector.evaluate('({ platform: process.platform, arch: process.arch })');
    assert.equal(info.platform, 'darwin'); assert.equal(info.arch, process.arch);
    // The main process persists opened files before the renderer installs its
    // close-state responder. Wait for the renderer's completed session handshake
    // and first visible paint before testing an explicit Quit.
    await until(() => inspector.evaluate(`(async () => {
      const window = process.getBuiltinModule('node:module').createRequire(process.execPath)('electron').BrowserWindow.getAllWindows()[0];
      if (!window || window.isDestroyed() || window.webContents.isLoading()) return false;
      return window.webContents.executeJavaScript("performance.getEntriesByName('md-document-ready', 'mark').length > 0");
    })()`), Boolean, 'Finder cold-start renderer ready', 30000);
    await inspector.evaluate("setImmediate(() => process.getBuiltinModule('node:module').createRequire(process.execPath)('electron').app.quit()); true");
    inspector.close(); inspector = null;
    let quitTimer;
    const code = await Promise.race([launcherExit, new Promise((_, reject) => { quitTimer = setTimeout(() => reject(new Error('Finder cold-start app did not quit')), 15000); })]).finally(() => clearTimeout(quitTimer));
    assert.equal(code, 0); ownedPid = null;
    console.log('PASS real Finder cold-start file event, isolated profile, and guarded application quit');
  } finally {
    inspector?.close();
    // Only this test's inspector-verified child PID is eligible for cleanup.
    if (Number.isSafeInteger(ownedPid) && ownedPid > 0) { try { process.kill(ownedPid, 'SIGTERM'); } catch {} }
    if (launcher.exitCode === null) launcher.kill();
    await launcherExit.catch(() => {});
  }
}

async function launch(profile, files) {
  const executablePath = process.env.MOYE_EXE || require('electron');
  const args = [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...files, '--user-data-dir=' + profile];
  const app = await electron.launch({ executablePath, args, timeout: 30000 });
  const item = { app, page: await app.firstWindow(), errors: [], profile, directory: path.dirname(profile) }; running.add(item);
  item.page.setDefaultTimeout(15000); item.page.on('pageerror', error => item.errors.push(error.message));
  await item.page.waitForFunction(() => document.querySelectorAll('[role=tab]').length > 0 && !document.querySelector('#mode').disabled);
  await app.evaluate(({ dialog }) => {
    globalThis.macErrors = []; globalThis.macPrompts = []; globalThis.macMenuDispatches = [];
    dialog.showErrorBox = (_title, message) => globalThis.macErrors.push(message);
    dialog.showMessageBox = async (_window, options) => { globalThis.macPrompts.push(options.message); return { response: 2 }; };
  });
  await item.page.evaluate(() => {
    window.macNativeCommandEvents = [];
    window.moye.onCommand(command => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      window.macNativeCommandEvents.push({ command, time: performance.now(),
        renameDisabled: document.querySelector('#rename')?.disabled,
        modeDisabled: document.querySelector('#mode')?.disabled,
        activeTabId: tab?.dataset.documentId, activeTabName: tab?.getAttribute('aria-label'),
        documentName: document.querySelector('#document-name')?.textContent,
        dialogs: [...document.querySelectorAll('dialog[open]')].map(node => node.id) });
      if (window.macNativeCommandEvents.length > 100) window.macNativeCommandEvents.shift();
    });
  });
  return item;
}
const ready = item => item.page.evaluate(() => window.moye.ready());
const visible = item => item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
async function command(item, name) {
  // Main-process tab state changes before the renderer's action finally unlocks
  // controls. Native commands are intentionally ignored while it is still busy.
  // Keep naming dialogs eligible so Undo/Redo can exercise ordinary input history.
  await until(() => item.page.evaluate(async () => {
    const backend = await window.moye.ready();
    const tab = document.querySelector('[role="tab"][aria-selected="true"]');
    const mode = document.querySelector('#mode'), rename = document.querySelector('#rename');
    const expectedName = backend.path?.split(/[\\/]/).pop() || backend.suggestedName;
    const documentName = document.querySelector('#document-name')?.textContent;
    return { interactive: Boolean(mode && rename && !mode.disabled && !rename.disabled && tab && !tab.disabled
      && tab.dataset.documentId === backend.id
      && (!expectedName || (tab.getAttribute('aria-label') === expectedName && documentName === expectedName))),
      backendId: backend.id, activeTabId: tab?.dataset.documentId, expectedName, documentName,
      activeTabName: tab?.getAttribute('aria-label'), modeDisabled: mode?.disabled, renameDisabled: rename?.disabled };
  }), value => value.interactive, 'renderer interactive before native ' + name);
  await item.app.evaluate(({ Menu }, name) => {
    const menuItem = Menu.getApplicationMenu().getMenuItemById('md-' + name);
    if (!menuItem) throw new Error('Missing native menu command ' + name);
    globalThis.macMenuDispatches.push({ name, id: menuItem.id, enabled: menuItem.enabled, visible: menuItem.visible });
    menuItem.click();
  }, name);
}

async function captureFailure(item, error) {
  const state = { error: { name: error.name, message: error.message, stack: error.stack },
    profile: item.profile, pageErrors: item.errors };
  try {
    state.renderer = await item.page.evaluate(() => {
      const summarize = node => node && ({ tag: node.tagName, id: node.id, type: node.type,
        disabled: node.disabled, readOnly: node.readOnly, hidden: node.hidden, role: node.getAttribute('role') });
      return { title: document.title, visibility: document.visibilityState, focused: document.hasFocus(),
        readyMarks: performance.getEntriesByName('md-document-ready', 'mark').map(mark => mark.startTime),
        documentName: document.querySelector('#document-name')?.textContent,
        activeElement: summarize(document.activeElement),
        buttons: [...document.querySelectorAll('button[id], #filename')].map(summarize),
        tabs: [...document.querySelectorAll('[role="tab"]')].map(node => ({ id: node.dataset.documentId,
          name: node.getAttribute('aria-label'), selected: node.getAttribute('aria-selected'), disabled: node.disabled })),
        dialogs: [...document.querySelectorAll('dialog')].map(node => ({ id: node.id, open: node.open,
          hidden: node.hidden, display: getComputedStyle(node).display })),
        nativeCommands: window.macNativeCommandEvents || [] };
    });
  } catch (failure) { state.rendererCaptureError = failure.message; }
  try {
    state.main = await item.app.evaluate(({ app, BrowserWindow }) => ({ profile: app.getPath('userData'),
      windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused() })),
      errors: globalThis.macErrors, prompts: globalThis.macPrompts, menuDispatches: globalThis.macMenuDispatches }));
  } catch (failure) { state.mainCaptureError = failure.message; }
  try { await item.page.screenshot({ path: path.join(item.directory, 'failure.png'), timeout: 5000 }); }
  catch (failure) { state.screenshotError = failure.message; }
  await writeFile(path.join(item.directory, 'failure-state.json'), JSON.stringify(state, null, 2) + '\n');
  console.error('Mac smoke failure evidence: ' + item.directory);
}

(async () => {
  assert.equal(process.platform, 'darwin', 'Native macOS smoke must run on a Mac.');
  const base = path.resolve('.desktop-test'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'macos-' + process.arch + '-'));
  const appPath = process.env.MOYE_APP && path.resolve(process.env.MOYE_APP);
  if (appPath) await finderColdStart(appPath, directory);
  else console.log('SKIP real Finder cold start: MOYE_APP is required for packaged-app association testing');

  const original = path.join(directory, '原文 with spaces.md'), later = path.join(directory, 'Finder 后续.md');
  await writeFile(original, '# Original\n'); await writeFile(later, '# Finder later\n');
  const item = await launch(path.join(directory, 'profile'), [original]), page = item.page;
  const info = await page.evaluate(() => ({ platform: window.moye.platform, arch: window.moye.arch }));
  assert.deepEqual(info, { platform: 'darwin', arch: process.arch });
  assert.equal((await page.evaluate(() => window.moye.getAppInfo())).platform, 'darwin');

  await page.keyboard.press('Meta+n');
  await until(() => ready(item), value => value.documents.length === 2, 'DOM Command+N opens one tab');
  await sleep(150); assert.equal((await ready(item)).documents.length, 2, 'DOM Command+N opens exactly one tab');
  await page.keyboard.press('Meta+w');
  await until(() => ready(item), value => value.documents.length === 1 && value.path === original, 'DOM Command+W closes only the new tab');
  assert.equal(await visible(item), true);

  await command(item, 'settings'); await page.locator('#settings-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#default-app').isVisible(), false, 'Windows registration control stays hidden on macOS');
  assert.equal(await page.locator('#default-app-settings').isVisible(), false, 'Windows settings shortcut stays hidden on macOS');
  assert.equal(await page.locator('#mac-default-app').isVisible(), true, 'Mac Finder guidance is visible');
  assert.match(await page.locator('#mac-default-app').textContent(), /Finder/);
  await page.screenshot({ path: path.join(directory, 'settings-zh.png') });
  await page.locator('#language-select').selectOption('en');
  await until(() => item.app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('md-open').label), value => value === 'Open', 'localized native menu');
  assert.equal(await page.locator('#default-app').isVisible(), false);
  assert.equal(await page.locator('#mac-default-app').isVisible(), true);
  assert.doesNotMatch(await page.locator('#mac-default-app').textContent(), /\p{Script=Han}/u);
  await page.screenshot({ path: path.join(directory, 'settings-en.png') });
  await page.locator('#language-select').selectOption('zh-CN');
  await page.locator('#settings-dialog button.primary').click();

  await page.locator('[data-view="source"]').click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const input = page.locator('.source-input'); await input.fill('# Command saved\n');
  await input.press('Meta+s');
  await until(() => readFile(original, 'utf8'), value => value === '# Command saved\n', 'DOM Command+S saves the document');
  const draft = '# Draft retained after close\n'; await input.fill(draft);
  await command(item, 'undo'); await until(() => input.inputValue(), value => value === '# Command saved\n', 'native Undo uses source history');
  await command(item, 'redo'); await until(() => input.inputValue(), value => value === draft, 'native Redo uses source history');

  await page.locator('#rename').click(); await page.locator('#name-dialog').waitFor({ state: 'visible' });
  const filename = page.locator('#filename'), initialName = await filename.inputValue();
  await filename.focus();
  await filename.evaluate(node => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.insertText('-native-undo');
  assert.equal(await filename.inputValue(), initialName + '-native-undo');
  await command(item, 'undo');
  await until(() => filename.inputValue(), value => value === initialName, 'native Undo edits ordinary naming input');
  assert.equal(await input.inputValue(), draft, 'ordinary input Undo does not consume document history');
  await page.screenshot({ path: path.join(directory, 'naming-native-undo.png') });
  await command(item, 'redo');
  await until(() => filename.inputValue(), value => value === initialName + '-native-undo', 'native Redo edits ordinary naming input');
  await page.locator('#name-cancel').click();
  assert.equal(await input.inputValue(), draft);
  await page.screenshot({ path: path.join(directory, 'source-draft.png') });

  // Exercise the packaged safe-rename helper through the real naming dialog.
  // A separate saved document keeps the existing unsaved/quit scenario intact.
  const draftId = (await ready(item)).id;
  const beforeRename = path.join(directory, '待改名 Markdown.md');
  const afterRename = path.join(directory, 'Mac 改名完成.md');
  const renamedContent = '# Packaged Mac rename\n\nPreserve the original bytes.\n';
  await writeFile(beforeRename, renamedContent);
  if (appPath) await execute('/usr/bin/open', ['-a', appPath, beforeRename]);
  else await item.app.evaluate(({ app }, file) => app.emit('open-file', { preventDefault() {} }, file), beforeRename);
  const renameState = await until(() => ready(item), value => value.path === beforeRename, 'Finder opens rename fixture');
  await page.waitForFunction(name => document.querySelector('#document-name').textContent === name && !document.querySelector('#rename').disabled, path.basename(beforeRename));
  await page.locator('#rename').click(); await page.locator('#name-dialog').waitFor({ state: 'visible' });
  await page.locator('#filename').fill(path.basename(afterRename));
  await page.locator('#name-confirm').click();
  await page.locator('#name-dialog').waitFor({ state: 'hidden' });
  await until(() => ready(item), value => value.id === renameState.id && value.path === afterRename, 'safe rename updates the same document');
  await page.waitForFunction(file => document.querySelector('#file-path').textContent === file && !document.querySelector('#rename').disabled, afterRename);
  assert.equal(await page.getByRole('tab', { name: path.basename(afterRename), exact: true }).count(), 1, 'renamed tab displays the new file name');
  await assert.rejects(readFile(beforeRename), { code: 'ENOENT' }, 'safe rename removes the original directory entry');
  assert.equal(await readFile(afterRename, 'utf8'), renamedContent, 'safe rename preserves saved content');
  await page.screenshot({ path: path.join(directory, 'renamed-document.png') });

  const mapFile = path.join(directory, 'Mac 文件关联.mdmap');
  await writeFile(mapFile, JSON.stringify({ format: 'md-mindmap', version: 1, root: 'root', nodes: [
    { id: 'root', parent: null, text: 'Mac 文件关联', file: null, collapsed: false },
    { id: 'linked', parent: 'root', text: '打开已改名的 Markdown', file: path.basename(afterRename), collapsed: false },
  ] }));
  if (appPath) await execute('/usr/bin/open', ['-a', appPath, mapFile]);
  else await item.app.evaluate(({ app }, file) => app.emit('open-file', { preventDefault() {} }, file), mapFile);
  const mapState = await until(() => ready(item), value => value.path === mapFile && value.type === 'mindmap', 'Finder opens the mind map');
  const linkedNode = page.locator('[data-node-id="linked"]'); await linkedNode.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  await page.screenshot({ path: path.join(directory, 'mindmap-linked-file.png') });
  await linkedNode.dblclick();
  const linkedState = await until(() => ready(item), value => value.path === afterRename && value.id === renameState.id, 'mind map double-click reuses the renamed Markdown tab');
  await page.waitForFunction(name => document.querySelector('#document-name').textContent === name && !document.querySelector('#save').disabled, path.basename(afterRename));
  assert.equal(linkedState.documents.length, mapState.documents.length, 'linked file opens without a duplicate Markdown tab');
  assert.equal(await page.locator('.tiptap h1').textContent(), 'Packaged Mac rename');
  await page.evaluate(id => window.moye.activateTab(id), draftId);
  await until(() => ready(item), value => value.id === draftId && value.path === original, 'return to original unsaved draft');
  await until(() => input.inputValue(), value => value === draft, 'rename and mind map navigation retain the original draft');
  console.log('PASS packaged safe rename through UI and Finder mind map linking to the renamed Markdown');

  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await until(() => visible(item), value => value === false, 'red close hides workspace');
  assert.equal(await item.app.evaluate(() => globalThis.macPrompts.length), 0, 'red close keeps draft without a save prompt');
  await item.app.evaluate(({ app }) => app.emit('activate'));
  await until(() => visible(item), Boolean, 'Dock activation shows workspace');
  assert.equal(await input.inputValue(), draft);

  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (appPath) await execute('/usr/bin/open', ['-a', appPath, later]);
  else await item.app.evaluate(({ app }, file) => app.emit('open-file', { preventDefault() {} }, file), later);
  await until(() => ready(item), value => value.documents.some(document => document.path === later), 'Finder warm file event');
  await until(() => visible(item), Boolean, 'Finder file shows hidden workspace');
  const state = await ready(item), originalId = state.documents.find(document => document.path === original).id;
  await page.evaluate(id => window.moye.activateTab(id), originalId);
  await until(() => input.inputValue(), value => value === draft, 'Finder open preserves background draft');
  if (appPath) await execute('/usr/bin/open', ['-a', appPath, original]);
  await sleep(150); assert.equal((await ready(item)).documents.filter(document => document.path === original).length, 1);

  await item.app.evaluate(({ app }) => app.quit());
  await until(() => item.app.evaluate(() => globalThis.macPrompts.length), value => value === 1, 'Quit asks about retained draft');
  await page.waitForFunction(() => !document.querySelector('.source-input').readOnly);
  assert.equal(await visible(item), true); assert.equal(await input.inputValue(), draft);
  await item.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await until(() => visible(item), value => value === false, 'canceled Quit resets ordinary red-close behavior');
  await item.app.evaluate(({ app }) => app.emit('activate'));

  assert.deepEqual(item.errors, []); assert.deepEqual(await item.app.evaluate(() => globalThis.macErrors), []);
  // Playwright injects page keyboard events through CDP, not macOS system menu
  // accelerators. Verify the native Quit role separately, then exercise the real
  // app.quit guard again after Cancel, observing its second prompt before Discard.
  const quitRoles = await item.app.evaluate(({ Menu }) => {
    const collect = menu => menu.items.flatMap(item => [item, ...(item.submenu ? collect(item.submenu) : [])]);
    return collect(Menu.getApplicationMenu()).filter(item => item.role === 'quit').map(item => item.role);
  });
  assert.deepEqual(quitRoles, ['quit'], 'application menu retains the standard native Quit role');
  await item.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (_window, options) => new Promise(resolve => {
      globalThis.macPrompts.push(options.message);
      globalThis.macConfirmQuit = () => resolve({ response: 1 });
    });
  });
  await item.app.evaluate(({ app }) => app.quit());
  await until(() => item.app.evaluate(() => globalThis.macPrompts.length), value => value === 2, 'second Quit asks again after Cancel');
  const closed = page.waitForEvent('close');
  await item.app.evaluate(() => { setImmediate(() => globalThis.macConfirmQuit()); });
  await closed;
  await item.app.close().catch(() => {}); running.delete(item);
  assert.equal(await readFile(original, 'utf8'), '# Command saved\n', 'Discard on Quit leaves saved original intact');
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
    finderColdStart: Boolean(appPath), nativeMenuCommands: true, nativeQuitRole: true,
    platformSettings: true, sourceAndNativeInputHistory: true, domCommandShortcuts: ['N', 'W', 'S'],
    systemCommandQ: 'not-tested', packagedSafeRename: true, finderMindmapLinkedFile: true,
    hideAndReactivate: true, quitCancelAndConfirmViaAppQuit: true }, null, 2) + '\n');
  console.log('MACOS PASS: native menu command dispatch and language, DOM Command+N/W/S, source history, packaged safe rename, mind map linked file, hide/reactivate, Finder warm open, native Quit role, app.quit Cancel then confirmed Discard; system Command+Q not tested; arch=' + process.arch);
})().catch(async error => {
  console.error(error); process.exitCode = 1;
  for (const item of running) await captureFailure(item, error).catch(failure => console.error('Failure evidence could not be saved:', failure));
}).finally(async () => {
  for (const item of running) {
    await item.app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await item.app.close().catch(() => {});
  }
});
