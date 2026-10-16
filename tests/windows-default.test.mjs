import assert from 'node:assert/strict';
import test from 'node:test';
import * as defaults from '../src/windows-default.mjs';
const { openWindowsDefaultApps } = defaults;

const executablePath = "C:\\工具 中文 & ' 目录\\MD.exe";
function fixture(overrides = {}) {
  const commands = [];
  const opened = [];
  return {
    commands, opened,
    options: {
      platform: 'win32', isPackaged: true, executablePath,
      systemRoot: 'C:\\Windows', release: '10.0.26100',
      accessImpl: async () => {},
      execFileImpl: async (...args) => { commands.push(args); },
      openExternal: async uri => { opened.push(uri); },
      ...overrides,
    },
  };
}

test('registers the running portable app through a fixed, hidden PowerShell invocation before opening Settings', async () => {
  const f = fixture();
  assert.deepEqual(await openWindowsDefaultApps(f.options), {
    status: 'opened', requiresUserChoice: true,
    registration: { status: 'registered' }, settings: { status: 'opened' },
  });
  assert.equal(f.commands.length, 1);
  const [program, args, options] = f.commands[0];
  assert.equal(program, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    "C:\\工具 中文 & ' 目录\\windows-integration.ps1", '-Action', 'RegisterDefaultApps', '-ExecutablePath', executablePath,
  ]);
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, false);
  assert.equal(options.timeout, 30000);
  assert.deepEqual(f.opened, ['ms-settings:defaultapps?registeredAppUser=MD']);
});

test('single-file default registration targets the renamed launcher while reading its bundled helper', async () => {
  const launcher = "C:\\Desktop\\MD Windows 0.1.26 (1) & ' 中文.exe";
  const runtime = 'C:\\Temp\\ns123.tmp\\app\\MD.exe';
  const f = fixture({ executablePath: launcher, runtimeExecutablePath: runtime });
  assert.equal((await openWindowsDefaultApps(f.options)).registration.status, 'registered');
  const [, args] = f.commands[0];
  assert.equal(args[5], 'C:\\Temp\\ns123.tmp\\app\\windows-integration.ps1');
  assert.equal(args.at(-1), launcher);
});

for (const release of ['10.0.19045', '10.0.22000', '10.0.22621', 'unknown']) {
  test(`uses the general default-app page for ${release}, without assuming a cumulative update is installed`, async () => {
    const f = fixture({ release });
    await openWindowsDefaultApps(f.options);
    assert.deepEqual(f.opened, ['ms-settings:defaultapps']);
  });
}

test('falls back to the general settings page if the app-specific launch fails', async () => {
  const opened = [];
  const f = fixture({ openExternal: async uri => { opened.push(uri); if (opened.length === 1) throw new Error('unavailable'); } });
  assert.equal((await openWindowsDefaultApps(f.options)).status, 'opened');
  assert.deepEqual(opened, ['ms-settings:defaultapps?registeredAppUser=MD', 'ms-settings:defaultapps']);
});

for (const [overrides, code] of [
  [{ platform: 'darwin' }, 'WINDOWS_DEFAULT_UNSUPPORTED'],
  [{ isPackaged: false }, 'WINDOWS_DEFAULT_DEVELOPMENT'],
  [{ executablePath: 'C:\\app\\electron.exe' }, 'WINDOWS_DEFAULT_REGISTRATION'],
  [{ executablePath: 'MD.exe' }, 'WINDOWS_DEFAULT_REGISTRATION'],
  [{ systemRoot: '' }, 'WINDOWS_DEFAULT_REGISTRATION'],
]) {
  test(`refuses invalid registration context: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(overrides);
    await assert.rejects(openWindowsDefaultApps(f.options), { message: code });
    assert.equal(f.commands.length, 0);
    assert.equal(f.opened.length, 0);
  });
}

test('registration failure preserves the real error and still opens general Settings for manual selection', async () => {
  const f = fixture({ execFileImpl: async () => { throw Object.assign(new Error('command failed'), { code: 1, stderr: 'Unexpected script failure' }); } });
  const result = await openWindowsDefaultApps(f.options);
  assert.equal(result.registration.status, 'failed');
  assert.equal(result.registration.code, 'FAILED');
  assert.match(result.registration.detail, /Unexpected script failure/);
  assert.match(result.registration.detail, /1/);
  assert.deepEqual(result.settings, { status: 'opened' });
  assert.equal(result.requiresUserChoice, true);
  assert.equal(result.status, 'opened');
  assert.deepEqual(f.opened, ['ms-settings:defaultapps']);
});

test('reports when both Settings launch attempts fail', async () => {
  const f = fixture({ openExternal: async () => { throw new Error('Settings unavailable'); } });
  const result = await openWindowsDefaultApps(f.options);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.registration, { status: 'registered' });
  assert.equal(result.settings.code, 'SETTINGS_FAILED');
  assert.match(result.settings.detail, /Settings unavailable/);
  assert.equal(f.commands.length, 1);
});

test('missing companion script is actionable and never starts PowerShell', async () => {
  const checked = [];
  const f = fixture({ accessImpl: async file => { checked.push(file); throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  const result = await openWindowsDefaultApps(f.options);
  assert.deepEqual(checked, ["C:\\工具 中文 & ' 目录\\windows-integration.ps1"]);
  assert.equal(result.registration.code, 'HELPER_MISSING');
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.opened, ['ms-settings:defaultapps']);
});

for (const [error, code] of [
  [Object.assign(new Error('spawn missing'), { code: 'ENOENT' }), 'POWERSHELL_MISSING'],
  [Object.assign(new Error('denied'), { code: 'EACCES' }), 'ACCESS_DENIED'],
  [Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', code: null }), 'TIMEOUT'],
  [Object.assign(new Error('too much output'), { killed: true, signal: 'SIGTERM', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), 'FAILED'],
  [Object.assign(new Error('failed'), { stderr: 'Registration conflict: HKCU:\\Software\\Classes\\Moye.MD.Markdown. Existing data was not changed.' }), 'CONFLICT'],
  [Object.assign(new Error('failed'), { stderr: 'Shortcut conflict: C:\\MD.lnk. Existing shortcut was not changed.' }), 'CONFLICT'],
  [Object.assign(new Error('failed'), { stderr: 'FullyQualifiedErrorId : System.UnauthorizedAccessException,Microsoft.PowerShell.Commands.NewItemCommand' }), 'ACCESS_DENIED'],
  [Object.assign(new Error('Access may be denied?'), { code: 1 }), 'FAILED'],
]) {
  test(`classifies only evidenced failures: ${error.message} / ${code}`, async () => {
    const f = fixture({ execFileImpl: async () => { throw error; } });
    const result = await openWindowsDefaultApps(f.options);
    assert.equal(result.registration.code, code);
    assert.equal(result.settings.status, 'opened');
  });
}

test('keeps both stage errors with bounded diagnostics and no control characters', async () => {
  const f = fixture({
    execFileImpl: async () => { throw Object.assign(new Error('failed'), { stderr: '\u0000\u001b' + 'x'.repeat(9000) }); },
    openExternal: async () => { throw new Error('Settings failed too'); },
  });
  const result = await openWindowsDefaultApps(f.options);
  assert.equal(result.status, 'failed');
  assert.equal(result.registration.code, 'FAILED');
  assert.ok(result.registration.detail.length <= 4000);
  assert.doesNotMatch(result.registration.detail, /[\u0000\u001b]/);
  assert.equal(result.settings.code, 'SETTINGS_FAILED');
  assert.match(result.settings.detail, /Settings failed too/);
});

test('manual Settings action is independent of packaging, PowerShell and file registration', async () => {
  const f = fixture({ isPackaged: false, executablePath: '', systemRoot: '' });
  const result = await defaults.openWindowsDefaultSettings(f.options);
  assert.deepEqual(result, {
    status: 'opened', requiresUserChoice: true,
    registration: { status: 'skipped' }, settings: { status: 'opened' },
  });
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.opened, ['ms-settings:defaultapps']);
});

test('manual Settings action reports launch failure without losing its cause', async () => {
  const f = fixture({ openExternal: async () => { throw new Error('No Settings handler'); } });
  const result = await defaults.openWindowsDefaultSettings(f.options);
  assert.equal(result.settings.code, 'SETTINGS_FAILED');
  assert.match(result.settings.detail, /No Settings handler/);
  assert.equal(f.commands.length, 0);
  await assert.rejects(defaults.openWindowsDefaultSettings({ ...f.options, platform: 'darwin' }), { message: 'WINDOWS_DEFAULT_UNSUPPORTED' });
});
