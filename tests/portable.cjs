const { chromium } = require('playwright');
const { access, copyFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile } = require('node:fs/promises');
const { fileURLToPath } = require('node:url');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const assert = require('node:assert/strict');

// Exercise the actual self-extracting executable, not the unpacked Electron app.
// Only these unique fixtures/profiles and the processes launched below are used.
const launched = new Set();
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await read(); if (accept(value)) return value; }
    catch (error) { if (error.fatal) throw error; lastError = error; }
    await sleep(100);
  }
  throw new Error(`Timed out: ${description}${lastError ? '\n' + lastError.message : ''}`);
}
function run(executable, profile, cwd, files = []) {
  const startedAt = Date.now();
  const child = spawn(executable, [...files, '--user-data-dir=' + profile, '--remote-debugging-port=0'], {
    cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const item = { child, browser: null, page: null, result: null, output: '', profile, startedAt };
  const capture = chunk => { item.output = (item.output + chunk).slice(-12000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  item.exited = new Promise(resolve => {
    child.once('error', error => { item.result = { error: error.message }; resolve(item.result); });
    child.once('exit', (code, signal) => { item.result = { code, signal }; resolve(item.result); });
  });
  launched.add(item);
  return item;
}
async function launcherWindow(item) {
  assert.ok(Number.isSafeInteger(item.child.pid) && item.child.pid > 0);
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Read only the launcher process we created. MainWindowHandle selects its
  // visible top-level window; no native clicks, registry or clipboard are used.
  const command = `$window = Get-Process -Id ${item.child.pid} -ErrorAction Stop; [pscustomobject]@{title=$window.MainWindowTitle; handle=$window.MainWindowHandle.ToInt64()} | ConvertTo-Json -Compress`;
  const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8',
  });
  return JSON.parse(stdout.trim());
}
async function attach(item) {
  const lines = await until(async () => {
    if (item.result) throw Object.assign(new Error('Launcher exited before readiness: ' + JSON.stringify(item.result) + '\n' + item.output), { fatal: true });
    const portFile = path.join(item.profile, 'DevToolsActivePort');
    // Chromium leaves this file behind on normal exit. A restored profile must
    // wait for its new runtime rather than connecting to the previous port.
    if ((await stat(portFile)).mtimeMs < item.startedAt) return null;
    return (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
  }, value => value && /^\d+$/.test(value[0]) && value[1]?.startsWith('/devtools/browser/'), 'portable app debugging endpoint', Number(process.env.MOYE_PORTABLE_START_TIMEOUT_MS) || 90000);
  item.browser = await chromium.connectOverCDP(`ws://127.0.0.1:${lines[0]}${lines[1]}`, { timeout: 30000 });
  item.page = await until(() => item.browser.contexts().flatMap(context => context.pages()), pages => pages.length > 0, 'portable window').then(pages => pages[0]);
  item.page.setDefaultTimeout(20000);
  await item.page.waitForSelector('[role=tab]');
  await item.page.waitForFunction(() => window.moye && !document.querySelector('#mode').disabled);
  item.runtimeDirectory = path.resolve(path.dirname(fileURLToPath(item.page.url())), '../..');
  await access(path.join(item.runtimeDirectory, 'MD.exe'));
  console.log(`READY ${path.basename(item.profile)}: ${((Date.now() - item.startedAt) / 1000).toFixed(1)}s`);
  return item.page;
}
async function removedRuntime(item) {
  assert.equal(item.result?.code, 0, 'The wrapper must exit normally after the test window closes.');
  await until(async () => {
    try { await access(item.runtimeDirectory); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }, Boolean, 'private runtime removed after normal exit');
}
async function close(item) {
  if (item.browser) {
    // Browser.close targets this isolated CDP connection; it cannot close an
    // existing user's MD process or any unrelated browser.
    const session = await item.browser.newBrowserCDPSession().catch(() => null);
    if (session) await session.send('Browser.close').catch(() => {});
    await item.browser.close().catch(() => {});
  }
  await Promise.race([item.exited, sleep(5000)]);
  if (!item.result && item.child.pid) {
    // A launcher waits for its own extracted runtime. If graceful shutdown was
    // blocked after a failed assertion, terminate only this still-owned tree.
    const cleanup = spawn('taskkill.exe', ['/PID', String(item.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => { cleanup.once('exit', resolve); cleanup.once('error', resolve); });
    await Promise.race([item.exited, sleep(5000)]);
  }
  launched.delete(item);
}
const ready = page => page.evaluate(() => window.moye.ready());

(async () => {
  assert.equal(process.platform, 'win32', 'The portable launcher integration test requires Windows.');
  assert.ok(process.env.MOYE_PORTABLE_EXE, 'Set MOYE_PORTABLE_EXE to the built single-file Windows executable.');
  const source = path.resolve(process.env.MOYE_PORTABLE_EXE);
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'single-file-'));
  const desktop = path.join(directory, '桌面 模拟');
  const renamed = path.join(directory, '另一个位置 中文');
  const documents = path.join(directory, '启动目录 文档');
  await Promise.all([desktop, renamed, documents].map(name => mkdir(name)));
  const desktopExe = path.join(desktop, 'MD.exe');
  const renamedExe = path.join(renamed, '我的 Markdown.exe');
  await copyFile(source, desktopExe);
  await copyFile(source, renamedExe);
  assert.deepEqual(await readdir(desktop), ['MD.exe'], 'Desktop copy must contain only the executable, with no DLL/resources beside it.');
  assert.deepEqual(await readdir(renamed), ['我的 Markdown.exe']);

  const first = run(desktopExe, path.join(directory, 'profile-plain'), documents);
  await until(() => launcherWindow(first), window => window.handle !== 0 && window.title === 'MD', 'visible startup feedback before extraction finishes');
  console.log(`BANNER visible: ${((Date.now() - first.startedAt) / 1000).toFixed(1)}s`);
  const plainPage = await attach(first);
  assert.equal((await launcherWindow(first)).handle, 0, 'The extraction banner must disappear once the actual app is ready.');
  assert.equal((await plainPage.evaluate(() => window.moye.getAppInfo())).version, require('../package.json').version);
  assert.equal((await ready(plainPage)).path, null, 'A copied executable starts without a document argument.');
  assert.equal((await ready(plainPage)).documents.length, 1);
  await close(first);
  await removedRuntime(first);
  assert.deepEqual(await readdir(desktop), ['MD.exe'], 'The launcher must not require generated files beside the desktop icon.');
  console.log('PASS lone executable in a Chinese/space desktop folder, visible startup feedback and banner disappears when ready');

  const note = path.join(documents, '第一份 笔记.md');
  const map = path.join(documents, '关联 导图.mdmap');
  const initial = '# Portable document\n\nOriginal text.\n';
  const edited = '# Portable document\n\nEdited from a single executable.\n';
  await writeFile(note, initial);
  await writeFile(map, JSON.stringify({
    format: 'md-mindmap', version: 2, root: 'root', connections: [],
    nodes: [
      { id: 'root', parent: null, text: '单文件导图', file: null, collapsed: false },
      { id: 'linked', parent: 'root', text: '关联笔记', file: path.basename(note), collapsed: false },
    ],
  }));
  const profile = path.join(directory, 'profile-renamed');
  const active = run(renamedExe, profile, documents, [path.basename(note)]);
  const page = await attach(active);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const initialState = await ready(page);
  assert.equal(initialState.path, note, 'Initial relative paths resolve against the caller directory, not the extraction directory.');
  assert.equal(initialState.content, initial);
  const noteId = initialState.id;
  await page.locator('[data-view=source]').click();
  await page.locator('#mode').click();
  await page.locator('.source-input').fill(edited);
  await page.locator('#save').click();
  await until(() => readFile(note, 'utf8'), value => value === edited, 'edited Markdown saved to the original path');
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  console.log('PASS renamed executable, initial relative Markdown path, source editing and saving');

  // The second wrapper must forward files and leave the first extraction alive
  // after it exits. A shared extraction directory can break this exact case.
  const second = run(renamedExe, profile, documents, [path.basename(map)]);
  const secondResult = await until(() => second.result, Boolean, 'second portable wrapper exits', 90000);
  assert.equal(secondResult.code, 0, JSON.stringify(secondResult) + '\n' + second.output);
  launched.delete(second);
  const mapState = await until(() => ready(page), state => state.path === map && state.documents.length === 2, 'second launch opens map in the existing window');
  assert.equal(mapState.type, 'mindmap');
  assert.equal(active.result, null, 'The first launcher/runtime remains alive after the second launcher exits.');
  assert.equal(active.browser.contexts().flatMap(context => context.pages()).length, 1, 'Second launch reuses the existing window.');
  assert.equal(await page.locator('[data-node-id=root]').textContent(), '单文件导图');
  await page.locator('[data-node-id=linked]').dblclick();
  const reopened = await until(() => ready(page), state => state.id === noteId, 'linked Markdown opens the existing tab');
  assert.equal(reopened.documents.length, 2);
  assert.equal(reopened.content, edited);
  assert.equal(await readFile(note, 'utf8'), edited);
  // Reload must still read the runtime's packaged UI after second-wrapper
  // cleanup, catching a deletion that a previously loaded page could conceal.
  await page.reload();
  await page.waitForSelector('[role=tab]');
  await page.waitForFunction(() => window.moye && !document.querySelector('#mode').disabled);
  assert.equal((await ready(page)).path, note);
  assert.equal((await ready(page)).documents.length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'portable-single-file.png') });
  await close(active);
  await removedRuntime(active);
  console.log('PASS second concurrent wrapper, relative mindmap path, linked tab reuse and runtime survives wrapper cleanup/reload');
  const restarted = run(renamedExe, profile, documents);
  const restoredPage = await attach(restarted);
  const restored = await ready(restoredPage);
  assert.equal(restored.path, note, 'Restart without file arguments restores the previous active document.');
  assert.equal(restored.documents.length, 2, 'Saved session tabs survive runtime cleanup.');
  assert.equal(restored.content, edited);
  assert.notEqual(restarted.runtimeDirectory, active.runtimeDirectory, 'Each launch uses its own runtime directory.');
  await close(restarted);
  await removedRuntime(restarted);
  assert.deepEqual(await readdir(renamed), ['我的 Markdown.exe']);
  console.log('PASS normal-exit runtime cleanup and saved session restoration across independent extractions');
  console.log('PORTABLE PASS; isolated fixtures: ' + directory);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const item of launched) await close(item);
});
