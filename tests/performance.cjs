const { chromium } = require('playwright');
const { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { performance } = require('node:perf_hooks');
const { fileURLToPath } = require('node:url');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

// Native, isolated benchmark. It never opens user documents, changes defaults,
// forces GC during natural memory sampling, or terminates an existing app. Working-set totals include shared
// pages more than once and must not be described as unique physical memory.
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const launched = new Set();
let reportContext;
const round = n => Math.round(n * 100) / 100;
const mib = n => round(n / 1048576);
const extraArgs = JSON.parse(process.env.MOYE_PERF_EXTRA_ARGS || '[]');
assert.ok(Array.isArray(extraArgs) && extraArgs.every(value => typeof value === 'string' && value.startsWith('--') && !/[\r\n\0]/.test(value)),
  'MOYE_PERF_EXTRA_ARGS must be a JSON array of command-line flag strings.');
async function until(read, accepts, name, timeout = 120000) {
  const deadline = performance.now() + timeout;
  let last;
  while (performance.now() < deadline) {
    try { const value = await read(); if (accepts(value)) return value; }
    catch (error) { if (error.fatal) throw error; last = error; }
    await sleep(25);
  }
  throw new Error('Timed out: ' + name + (last ? '\n' + last.message : ''));
}
function run(executable, profile, cwd, files = [], cacheHome) {
  const startedWall = Date.now(), started = performance.now();
  const child = spawn(executable, [...files, ...extraArgs, '--user-data-dir=' + profile, '--remote-debugging-port=0'], {
    cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: cacheHome ? { ...process.env, MD_PORTABLE_CACHE_HOME: cacheHome } : process.env,
  });
  const item = { child, profile, startedWall, started, browser: null, page: null, result: null, output: '' };
  const capture = value => { item.output = (item.output + value).slice(-16000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  item.exited = new Promise(resolve => {
    child.once('error', error => { item.result = { error: error.message }; resolve(item.result); });
    child.once('exit', (code, signal) => { item.result = { code, signal }; resolve(item.result); });
  });
  launched.add(item);
  return item;
}
async function painted(page) {
  await page.waitForSelector('[role=tab]');
  await page.waitForFunction(() => window.moye && !document.querySelector('#mode').disabled &&
    document.querySelector('.tiptap')?.getBoundingClientRect().height > 0 && document.visibilityState === 'visible');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function assertScenario(item) {
  if (!item.expectedScenario) return;
  const actual = await item.page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role=tab]')].map(node => node.getAttribute('aria-label')),
    activeName: document.querySelector('#document-name')?.textContent,
    visibleEditors: [...document.querySelectorAll('.tiptap')].filter(node => node.getBoundingClientRect().height > 0).length,
  }));
  assert.deepEqual([...actual.tabs].sort(), [...item.expectedScenario.tabs].sort(), 'Unexpected tabs during the benchmark: ' + JSON.stringify(actual));
  assert.equal(actual.activeName, item.expectedScenario.activeName, 'The active benchmark document changed unexpectedly.');
  assert.equal(actual.visibleEditors, 1, 'The benchmark must retain one visible Markdown document, not a different view.');
}
async function phase(item, label) {
  item.phase = label;
  await item.page.evaluate(value => { window.__benchmarkPhase = value; }, label);
}
async function attach(item) {
  const endpoint = await until(async () => {
    if (item.result) throw Object.assign(new Error('App exited before ready: ' + JSON.stringify(item.result) + '\n' + item.output), { fatal: true });
    const portFile = path.join(item.profile, 'DevToolsActivePort');
    if ((await stat(portFile)).mtimeMs < item.startedWall) return null;
    return (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
  }, value => value && /^\d+$/.test(value[0]) && value[1]?.startsWith('/devtools/browser/'), 'new CDP endpoint');
  item.endpointMs = round(performance.now() - item.started);
  item.browser = await chromium.connectOverCDP(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`);
  item.page = (await until(() => item.browser.contexts().flatMap(context => context.pages()), value => value.length, 'app page'))[0];
  item.page.setDefaultTimeout(20000);
  await painted(item.page);
  item.readyMs = round(performance.now() - item.started);
  if (process.env.MOYE_PERF_EXPECT_MARKER === '1') {
    await item.page.waitForFunction(() => performance.getEntriesByName('md-document-ready', 'mark').length === 1);
  }
  item.rendererTiming = await item.page.evaluate(() => {
    const marker = performance.getEntriesByName('md-document-ready', 'mark')[0];
    return { timeOrigin: performance.timeOrigin, markerMs: marker?.startTime ?? null,
      firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null };
  });
  item.applicationReadyMs = item.rendererTiming.markerMs == null ? null :
    round(item.rendererTiming.timeOrigin + item.rendererTiming.markerMs - item.startedWall);
  item.runtimeDirectory = path.resolve(path.dirname(fileURLToPath(item.page.url())), '../..');
  const runtimeFile = await stat(path.join(item.runtimeDirectory, 'MD.exe'));
  // NSIS can preserve embedded file creation times, so file birthtime is not
  // evidence of a cache hit. Check the dedicated cache directory before launch.
  item.runtimeFileCreationTime = runtimeFile.birthtime.toISOString();
  await item.page.evaluate(() => {
    window.__benchmarkEvents = [];
    document.addEventListener('click', event => {
      const target = event.target.closest('button,[role=tab]');
      if (!target) return;
      window.__benchmarkEvents.push({ time: performance.now(), phase: window.__benchmarkPhase || 'startup',
        id: target.id, name: target.getAttribute('aria-label') || target.textContent, trusted: event.isTrusted });
      if (window.__benchmarkEvents.length > 150) window.__benchmarkEvents.shift();
    }, true);
  });
  // Real UI input must work after readiness. Keep this separate from startup so
  // Playwright's actionability/stability waits do not silently become app time.
  const inputStart = performance.now();
  await item.page.locator('[data-view=source]').click();
  await item.page.waitForFunction(() => !!document.querySelector('.source-input') &&
    document.querySelector('.source-input').getBoundingClientRect().height > 0);
  item.firstInteractionMs = round(performance.now() - inputStart);
  await item.page.locator('[data-view=render]').click();
  await painted(item.page);
  return item.page;
}
async function close(item) {
  if (item.browser) {
    const session = await item.browser.newBrowserCDPSession().catch(() => null);
    if (session) await Promise.race([session.send('Browser.close').catch(() => {}), sleep(5000)]);
    await Promise.race([item.browser.close().catch(() => {}), sleep(5000)]);
  }
  await Promise.race([item.exited, sleep(5000)]);
  if (!item.result && item.child.pid) {
    const cleanup = spawn('taskkill.exe', ['/PID', String(item.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => { cleanup.once('exit', resolve); cleanup.once('error', resolve); });
    await Promise.race([item.exited, sleep(5000)]);
  }
  launched.delete(item);
}
async function memory(item, script, label, settleMs) {
  await phase(item, 'memory:' + label);
  await assertScenario(item);
  await sleep(settleMs);
  const samples = [];
  const diagnostics = await item.page.context().newCDPSession(item.page);
  for (let index = 0; index < 3; index++) {
    await assertScenario(item);
    const { stdout } = await execute(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-RootProcessId', String(item.child.pid)],
      { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 200000 });
    const processes = JSON.parse(stdout.trim());
    assert.ok(processes.length > 1, 'Expected the owned app process tree, not only its launcher.');
    const heap = await diagnostics.send('Runtime.getHeapUsage');
    const dom = await diagnostics.send('Memory.getDOMCounters');
    const renderer = await item.page.evaluate(() => ({
      documentNodes: document.querySelectorAll('*').length,
      visibleEditors: document.querySelectorAll('.tiptap').length,
      tabs: document.querySelectorAll('[role=tab]').length,
    }));
    Object.assign(renderer, { jsHeapUsedMiB: mib(heap.usedSize), jsHeapTotalMiB: mib(heap.totalSize),
      embedderHeapUsedMiB: mib(heap.embedderHeapUsedSize || 0), totalDomNodes: dom.nodes,
      totalDocuments: dom.documents, totalEventListeners: dom.jsEventListeners });
    samples.push({
      privateBytesMiB: mib(processes.reduce((sum, entry) => sum + entry.privateBytes, 0)),
      workingSetSumMiB: mib(processes.reduce((sum, entry) => sum + entry.workingSet, 0)),
      processes, renderer,
    });
    await assertScenario(item);
    if (index !== 2) await sleep(800);
  }
  const median = key => [...samples].sort((a, b) => a[key] - b[key])[1][key];
  await diagnostics.detach();
  const range = key => [Math.min(...samples.map(sample => sample[key])), Math.max(...samples.map(sample => sample[key]))];
  const result = { label, settleMs, privateBytesMiB: median('privateBytesMiB'), workingSetSumMiB: median('workingSetSumMiB'),
    privateBytesRangeMiB: range('privateBytesMiB'), workingSetSumRangeMiB: range('workingSetSumMiB'), samples };
  console.log('MEMORY ' + label + ': private ' + result.privateBytesMiB + ' MiB; working-set sum ' + result.workingSetSumMiB + ' MiB');
  return result;
}

(async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(process.env.MOYE_PERF_EXE, 'Set MOYE_PERF_EXE to an immutable built executable.');
  const source = path.resolve(process.env.MOYE_PERF_EXE);
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'performance-'));
  const documents = path.join(directory, '文档 中文'); await mkdir(documents);
  let executable = source;
  if (process.env.MOYE_PERF_COPY_SINGLE === '1') {
    executable = path.join(directory, '独立 MD.exe'); await copyFile(source, executable);
  }
  const reportPath = path.join(directory, 'performance.json');
  const report = {
    label: process.env.MOYE_PERF_LABEL || path.basename(source), createdAt: new Date().toISOString(), source, executable,
    executableSha256: null, extraArgs,
    environment: { platform: process.platform, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, physicalMemoryMiB: mib(os.totalmem()), node: process.version },
    criteria: { startup: 'readyMs is a conservative spawn-to-visible-document observation including CDP attachment/polling and two animation frames. applicationReadyMs, when present, uses the app md-document-ready performance mark and wall-clock-aligned performance.timeOrigin; FCP alone is not document readiness. Empty runtime cache is isolated per cold launch; OS file cache/Defender state is uncontrolled, not a reboot/cold-disk test.', memory: 'three process-tree snapshots after settling; sum of process PrivateMemorySize64 (private committed bytes) and WorkingSet64 separately; shared working-set pages can be counted multiple times; no forced GC', documents: 'eight generated Markdown files with 100 sections each; 9 code fences per file; no images; edits saved to benchmark fixtures only' },
    startups: [], memory: [], existingOpen: null,
  };
  const checkpoint = async () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  reportContext = { directory, report, checkpoint };
  await checkpoint();
  console.log('PERFORMANCE fixtures: ' + directory);
  const memoryScript = path.join(directory, 'memory.ps1');
  await writeFile(memoryScript, `param([int]$RootProcessId)\n[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)\n$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine)\n$owned = [System.Collections.Generic.HashSet[int]]::new()\n[void]$owned.Add($RootProcessId)\ndo { $changed=$false; foreach($entry in $all) { if($owned.Contains([int]$entry.ParentProcessId) -and $owned.Add([int]$entry.ProcessId)) { $changed=$true } } } while($changed)\n$rows = @(foreach($entry in $all) { if($owned.Contains([int]$entry.ProcessId)) { $process=Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue; if($process) { $role=if($entry.CommandLine -match '--type=([^ ]+)') {$Matches[1]} elseif($entry.ProcessId -eq $RootProcessId) {'root'} else {'browser'}; [pscustomobject]@{pid=[int]$entry.ProcessId;parent=[int]$entry.ParentProcessId;role=$role;name=$process.ProcessName;privateBytes=$process.PrivateMemorySize64;workingSet=$process.WorkingSet64} } } })\nConvertTo-Json -InputObject $rows -Compress\n`);
  const existingCacheHome = process.env.MOYE_PERF_EXISTING_CACHE_HOME ? path.resolve(process.env.MOYE_PERF_EXISTING_CACHE_HOME) : null;
  if (existingCacheHome) {
    const relative = path.relative(base, existingCacheHome);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Reuse only an existing isolated benchmark cache under .desktop-test.');
    assert.ok((await stat(existingCacheHome)).isDirectory());
  }
  let profile = existingCacheHome ? path.join(directory, 'profile-reused-cache') : undefined, cacheHome = existingCacheHome;
  const iterations = Math.max(1, Number(process.env.MOYE_PERF_ITERATIONS) || 3);
  const coldStarts = existingCacheHome ? 0 : Math.max(1, Number(process.env.MOYE_PERF_COLD_STARTS) || 1);
  const warmStarts = process.env.MOYE_PERF_WARM_STARTS == null ? iterations - 1 : Number(process.env.MOYE_PERF_WARM_STARTS);
  assert.ok(Number.isSafeInteger(coldStarts) && coldStarts >= 0 && Number.isSafeInteger(warmStarts) && warmStarts >= 0 && coldStarts + warmStarts > 0);
  const settleMs = Math.max(1000, Number(process.env.MOYE_PERF_SETTLE_MS) || 5000);
  let active;
  const launchCount = coldStarts + warmStarts;
  for (let index = 0; index < launchCount; index++) {
    const cold = index < coldStarts;
    if (cold) {
      profile = path.join(directory, 'profile-' + index);
      cacheHome = path.join(directory, 'runtime-cache-' + index);
      await assert.rejects(stat(cacheHome), { code: 'ENOENT' }, 'Each cold run must start with an absent isolated runtime cache.');
    }
    const cacheHomeExistedBeforeLaunch = await stat(cacheHome).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    active = run(executable, profile, documents, [], cacheHome);
    await attach(active);
    const appInfo = await active.page.evaluate(() => window.moye.getAppInfo());
    report.version = appInfo.version;
    const startup = { label: cold ? 'empty-runtime-cache-' + (index + 1) : 'repeated-profile-' + (index - coldStarts + 1),
      endpointMs: active.endpointMs, readyMs: active.readyMs, applicationReadyMs: active.applicationReadyMs,
      rendererTiming: active.rendererTiming, firstInteractionMs: active.firstInteractionMs,
      runtimeDirectory: active.runtimeDirectory, runtimeFileCreationTime: active.runtimeFileCreationTime, cacheHome, cacheHomeExistedBeforeLaunch };
    report.startups.push(startup); console.log('STARTUP ' + JSON.stringify(startup)); await checkpoint();
    if (index < launchCount - 1) { await close(active); await sleep(1500); }
  }
  active.expectedScenario = await active.page.evaluate(() => ({ tabs: [...document.querySelectorAll('[role=tab]')].map(node => node.getAttribute('aria-label')),
    activeName: document.querySelector('#document-name').textContent }));
  assert.equal(active.expectedScenario.tabs.length, 1, 'A fresh benchmark profile starts with one welcome document.');
  report.memory.push(await memory(active, memoryScript, 'welcome', settleMs)); await checkpoint();
  if (process.env.MOYE_PERF_SKIP_DOCUMENTS !== '1') {
    const files = [];
    for (let index = 0; index < 8; index++) {
      const name = '基准文档 ' + (index + 1) + '.md'; files.push(name);
      const content = '# Performance document ' + (index + 1) + '\n\n' + Array.from({ length: 100 }, (_, section) =>
        '## Section ' + (section + 1) + '\n\n' +
        ('这是一段中文和 English 混排正文，用于测量真实 Markdown 阅读和编辑。 **Bold text** and *emphasis*. ' +
         'A reproducible document makes startup and memory comparisons meaningful. ').repeat(3) + '\n\n' +
        (section % 12 === 0 ? '- A list item\n- Another item\n\n```javascript\nconst section = ' + section + ';\nconsole.log(section);\n```\n\n' : '')).join('');
      await writeFile(path.join(documents, name), content);
      if (index === 0) report.documentBytesEach = Buffer.byteLength(content);
    }
    const old = await active.page.evaluate(() => window.moye.ready());
    const secondary = run(executable, profile, documents, files, cacheHome);
    await phase(active, 'open-eight-files');
    await until(() => active.page.evaluate(() => window.moye.ready()), state => state.documents.length === 9 && state.path === path.join(documents, files[7]), 'all eight documents opened');
    await active.page.waitForFunction(() => document.querySelector('.tiptap h1')?.textContent === 'Performance document 8');
    await painted(active.page);
    report.existingOpen = { eightFilesReadyMs: round(performance.now() - secondary.started) };
    const secondaryResult = await until(() => secondary.result, Boolean, 'secondary launch completed');
    assert.equal(secondaryResult.code, 0); launched.delete(secondary);
    console.log('EXISTING OPEN ' + JSON.stringify(report.existingOpen));
    await active.page.evaluate(id => window.moye.closeTab(id), old.id);
    await active.page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 8);
    active.expectedScenario = { tabs: files, activeName: files[7] };
    report.memory.push(await memory(active, memoryScript, 'eight-open-last-active', settleMs)); await checkpoint();
    const states = (await active.page.evaluate(() => window.moye.ready())).documents;
    for (const state of states) {
      await assertScenario(active);
      await phase(active, 'read:' + path.basename(state.path));
      await active.page.getByRole('tab', { name: path.basename(state.path), exact: true }).click();
      await active.page.waitForFunction(name => document.querySelector('#document-name').textContent === name, path.basename(state.path));
      active.expectedScenario.activeName = path.basename(state.path);
      await painted(active.page);
      await active.page.locator('.canvas').evaluate(node => node.scrollTo({ top: 800, behavior: 'instant' }));
      await assertScenario(active);
    }
    report.memory.push(await memory(active, memoryScript, 'eight-read-visited', settleMs)); await checkpoint();
    for (const state of states) {
      await assertScenario(active);
      await phase(active, 'edit:' + path.basename(state.path));
      await active.page.getByRole('tab', { name: path.basename(state.path), exact: true }).click();
      await active.page.waitForFunction(name => document.querySelector('#document-name').textContent === name, path.basename(state.path));
      active.expectedScenario.activeName = path.basename(state.path);
      await active.page.locator('#mode').click();
      await active.page.waitForFunction(() => document.querySelector('.tiptap')?.getAttribute('contenteditable') === 'true');
      await active.page.locator('.tiptap p').first().click();
      await active.page.keyboard.press('End'); await active.page.keyboard.insertText(' Memory benchmark edit.');
      await active.page.locator('#save').click();
      await active.page.waitForFunction(() => document.querySelector('#dirty-dot').hidden);
      await assertScenario(active);
    }
    report.memory.push(await memory(active, memoryScript, 'eight-edited-saved-visited', settleMs)); await checkpoint();
    await active.page.screenshot({ path: path.join(directory, 'performance.png') });
    if (process.env.MOYE_PERF_RETAINED === '1') {
      // Optional diagnostic AFTER all natural samples: separates retained
      // objects from garbage awaiting collection. Never a user-memory claim.
      const diagnostic = await active.page.context().newCDPSession(active.page);
      const before = { heap: await diagnostic.send('Runtime.getHeapUsage'), dom: await diagnostic.send('Memory.getDOMCounters') };
      await diagnostic.send('HeapProfiler.collectGarbage');
      const after = { heap: await diagnostic.send('Runtime.getHeapUsage'), dom: await diagnostic.send('Memory.getDOMCounters') };
      report.retainedObjectsDiagnostic = { note: 'Isolated benchmark only; explicit diagnostic collection AFTER the normal-memory samples', before, after };
      await diagnostic.detach(); await checkpoint();
    }
  }
  await close(active);
  // Hash only after timings: reading the whole executable before launching it
  // would warm the file cache and contaminate a first-start measurement.
  report.executableSha256 = createHash('sha256').update(await readFile(source)).digest('hex');
  report.completedAt = new Date().toISOString(); await checkpoint();
  console.log('PERFORMANCE PASS: ' + reportPath);
})().catch(async error => {
  console.error(error); process.exitCode = 1;
  if (reportContext) {
    const snapshots = [];
    for (const item of launched) {
      if (!item.page || item.page.isClosed()) continue;
      const snapshot = await item.page.evaluate(async () => ({ url: location.href, title: document.title,
        tabs: [...document.querySelectorAll('[role=tab]')].map(node => ({ name: node.getAttribute('aria-label'), selected: node.getAttribute('aria-selected') })),
        events: window.__benchmarkEvents, ready: await window.moye.ready() })).catch(failure => ({ error: failure.message }));
      snapshots.push({ profile: item.profile, phase: item.phase, expected: item.expectedScenario, snapshot });
      await item.page.screenshot({ path: path.join(reportContext.directory, 'failure.png'), timeout: 5000 }).catch(() => {});
    }
    await writeFile(path.join(reportContext.directory, 'failure.json'), JSON.stringify({ error: error.stack, snapshots }, null, 2) + '\n');
    reportContext.report.failure = error.message;
    await reportContext.checkpoint();
  }
}).finally(async () => {
  for (const item of launched) await close(item);
});
