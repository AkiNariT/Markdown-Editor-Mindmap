const { chromium } = require('playwright');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { access, mkdir, mkdtemp, readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

// Run real release executables. Unlike Playwright's Electron launcher, this
// deliberately passes inherited Node-mode variables to the application.
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scenarios = {
  clean: {},
  'run-as-node': { ELECTRON_RUN_AS_NODE: '1' },
  'node-options': { NODE_OPTIONS: '--md-invalid-startup-option' },
  combined: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--md-invalid-startup-option' },
};
async function until(read, accept, description, timeout = 90000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await read(); if (accept(value)) return value; }
    catch (error) { if (error.fatal) throw error; last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out: ${description}${last ? '\n' + last.message : ''}`);
}
async function smoke(executable, kind, scenario, directory, fixture) {
  const profile = path.join(directory, `${kind}-${scenario}`);
  const env = { ...process.env, MD_PORTABLE_CACHE_HOME: path.join(directory, 'runtime-cache') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  Object.assign(env, scenarios[scenario]);
  const started = Date.now();
  const child = spawn(executable, [fixture, '--user-data-dir=' + profile, '--remote-debugging-port=0'], {
    // This is the GUI being tested. Hiding its startup window makes Windows
    // report MainWindowHandle=0 even while Electron renders a visible DOM.
    // Keep background inspection/cleanup helpers hidden instead.
    cwd: directory, env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let result = null, output = '', browser = null, failure = null;
  const evidence = { executable, kind, scenario, profile, startedAt: new Date(started).toISOString(), launcherPid: child.pid };
  const capture = chunk => { output = (output + chunk).slice(-16000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const exited = new Promise(resolve => {
    child.once('error', error => { result = { error: error.message }; resolve(); });
    child.once('exit', (code, signal) => { result = { code, signal }; resolve(); });
  });
  const assertRunning = () => {
    if (result) throw Object.assign(new Error(`Application exited before startup completed: ${JSON.stringify(result)}\n${output}`), { fatal: true });
  };
  try {
    const endpoint = await until(async () => {
      assertRunning();
      return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
    }, lines => /^\d+$/.test(lines[0]) && lines[1]?.startsWith('/devtools/browser/'), `${kind}/${scenario} endpoint`);
    browser = await chromium.connectOverCDP(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`);
    const pages = await until(() => browser.contexts().flatMap(context => context.pages()), values => values.length > 0, 'application window');
    const page = pages[0];
    await page.waitForFunction(() => window.moye && !document.querySelector('#mode')?.disabled, undefined, { timeout: 30000 });
    await page.locator('[role=tab]').first().waitFor({ state: 'visible' });
    const state = await page.evaluate(() => window.moye.ready());
    assert.equal(state.path, fixture, 'The supplied Markdown must actually open in the rendered application.');
    assert.equal((await stat(profile)).isDirectory(), true, 'Startup creates its isolated userData directory.');
    const session = await browser.newBrowserCDPSession();
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const main = processInfo.find(item => item.type === 'browser');
    assert.ok(Number.isSafeInteger(main?.id) && main.id > 0, 'CDP must identify the application process.');
    evidence.browserPid = main.id;
    await sleep(Math.max(0, 5000 - (Date.now() - started)));
    assertRunning();
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${main.id} -ErrorAction Stop; [pscustomobject]@{handle=$p.MainWindowHandle.ToInt64();title=$p.MainWindowTitle} | ConvertTo-Json -Compress`],
    { windowsHide: true, timeout: 10000, encoding: 'utf8' });
    evidence.nativeWindow = JSON.parse(stdout.trim());
    evidence.checkedAfterMs = Date.now() - started;
    assert.notEqual(evidence.nativeWindow.handle, 0, 'The app must retain a visible native window after five seconds.');
    const appInfo = await page.evaluate(() => window.moye.getAppInfo());
    evidence.version = appInfo.version;
    assert.equal(appInfo.version, process.env.MOYE_STARTUP_EXPECT_VERSION || require('../package.json').version, 'The actual release version must match the package under test.');
    // Playwright's surface capture can stall after startup assertions succeed
    // on a shared Windows desktop. Capture the native view instead, without
    // changing the application's launch flags or skipping screenshot failures.
    await page.bringToFront();
    const captureSession = await page.context().newCDPSession(page);
    let captureTimer;
    try {
      const frame = await Promise.race([
        captureSession.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }),
        new Promise((_, reject) => { captureTimer = setTimeout(() => reject(new Error('Native view screenshot timed out.')), 30000); }),
      ]);
      const png = Buffer.from(frame.data, 'base64');
      assert.ok(png.length > 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Startup evidence must be a PNG.');
      assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'Startup evidence must have nonzero dimensions.');
      await writeFile(path.join(directory, `${kind}-${scenario}.png`), png);
      evidence.captureMethod = 'Page.captureScreenshot/fromSurface=false';
    } finally {
      clearTimeout(captureTimer);
      await captureSession.detach().catch(() => {});
    }
    console.log(`PASS ${kind}/${scenario}: window, document, userData; version ${appInfo.version}`);
  } catch (error) {
    failure = error.message;
    throw error;
  } finally {
    if (browser) {
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    }
    await Promise.race([exited, sleep(5000)]);
    if (!result && child.pid) {
      // Only the still-owned process tree from this smoke test is terminated.
      await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => {});
      await Promise.race([exited, sleep(5000)]);
    }
    await writeFile(path.join(directory, `${kind}-${scenario}.log`), JSON.stringify({ evidence, failure, result, output }, null, 2));
  }
}

(async () => {
  assert.equal(process.platform, 'win32', 'This release smoke test requires Windows.');
  const artifacts = [['folder', process.env.MOYE_EXE], ['portable', process.env.MOYE_PORTABLE_EXE]].filter(([, file]) => file);
  assert.ok(artifacts.length, 'Set MOYE_EXE and/or MOYE_PORTABLE_EXE to the actual release executables.');
  const selected = (process.env.MOYE_STARTUP_SCENARIOS || Object.keys(scenarios).join(',')).split(',');
  assert.ok(selected.every(name => Object.hasOwn(scenarios, name)), 'Unknown startup scenario.');
  const base = path.resolve(__dirname, '../.desktop-test');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'packaged-startup-'));
  const fixture = path.join(directory, '启动测试 中文.md');
  await writeFile(fixture, '# Release startup\n\nThe packaged application must open this document.\n');
  console.log('Smoke artifacts: ' + directory);
  for (const [kind, file] of artifacts) {
    const executable = path.resolve(file);
    await access(executable);
    for (const scenario of selected) await smoke(executable, kind, scenario, directory, fixture);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
