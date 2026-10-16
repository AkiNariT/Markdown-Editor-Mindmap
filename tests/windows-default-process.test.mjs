import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { openWindowsDefaultApps } from '../src/windows-default.mjs';

const execute = promisify(execFile);
const fixtureRoot = fileURLToPath(new URL('../.desktop-test/', import.meta.url));
const windowsOnly = { skip: process.platform !== 'win32', timeout: 20000 };

async function fixture(t, body, overrides = {}) {
  await mkdir(fixtureRoot, { recursive: true });
  // Exercise real argument handling with spaces, Unicode and shell metacharacters.
  const directory = await mkdtemp(path.join(fixtureRoot, "default-process 中文 & ' "));
  t.after(async () => {
    const relative = path.relative(fixtureRoot, directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(directory, { recursive: true, force: true });
  });
  const executablePath = path.join(directory, 'MD.exe');
  await writeFile(executablePath, 'Test fixture only; never executed.');
  // These fixtures never access the registry, shortcuts or Windows Settings.
  await writeFile(path.join(directory, 'windows-integration.ps1'), '\ufeff' + [
    'param([string]$Action, [string]$ExecutablePath)',
    "$ErrorActionPreference = 'Stop'",
    "if ($Action -ne 'RegisterDefaultApps') { throw 'Unexpected action' }",
    "if (-not (Test-Path -LiteralPath $ExecutablePath)) { throw 'Executable argument was corrupted' }",
    body,
  ].join('\r\n'));
  const opened = [];
  return {
    opened,
    result: await openWindowsDefaultApps({
      isPackaged: true, executablePath, release: '10.0.26100',
      openExternal: async uri => { opened.push(uri); },
      ...overrides,
    }),
  };
}

function assertManualFallback({ opened, result }, expectedCode) {
  assert.equal(result.registration.status, 'failed');
  assert.equal(result.registration.code, expectedCode);
  assert.ok(result.registration.detail.length > 0);
  assert.ok(result.registration.detail.length <= 4000);
  assert.doesNotMatch(result.registration.detail, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  assert.deepEqual(result.settings, { status: 'opened' });
  assert.equal(result.status, 'opened');
  assert.equal(result.requiresUserChoice, true);
  assert.deepEqual(opened, ['ms-settings:defaultapps']);
}

test('real PowerShell conflict stderr is preserved and manual Settings remains available', windowsOnly, async t => {
  const f = await fixture(t, "throw 'Registration conflict: isolated-regression-fixture. Existing data was not changed.'");
  assertManualFallback(f, 'CONFLICT');
  assert.match(f.result.registration.detail, /Registration conflict: isolated-regression-fixture/);
  assert.match(f.result.registration.detail, /Existing data was not changed/);
  assert.match(f.result.registration.detail, /^1\n/);
});

test('real unexpected PowerShell failure retains its cause without inventing a permission error', windowsOnly, async t => {
  const f = await fixture(t, "throw 'MD_REGRESSION_UNEXPECTED: specific failure from child process'");
  assertManualFallback(f, 'FAILED');
  assert.match(f.result.registration.detail, /MD_REGRESSION_UNEXPECTED: specific failure from child process/);
  assert.match(f.result.registration.detail, /^1\n/);
});

test('real PowerShell timeout is classified and still allows manual Settings', windowsOnly, async t => {
  const f = await fixture(t, 'Start-Sleep -Seconds 30', {
    execFileImpl: (program, args, options) => execute(program, args, { ...options, timeout: 1500 }),
  });
  assertManualFallback(f, 'TIMEOUT');
  assert.match(f.result.registration.detail, /SIGTERM/);
});

test('real registration script emits Unicode error paths as UTF-8 even from a legacy console', windowsOnly, async t => {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureRoot, 'default-encoding-'));
  t.after(async () => {
    const relative = path.relative(fixtureRoot, directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(directory, { recursive: true, force: true });
  });
  const missingExecutable = path.join(directory, '未安装 程序 中文', 'MD.exe');
  const script = fileURLToPath(new URL('../scripts/windows-integration.ps1', import.meta.url));
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  // The absent executable makes the real script fail before reading or writing
  // registrations. DryRun independently prevents any shell integration writes.
  const command = [
    '[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(936)',
    `& ${literal(script)} -Action RegisterDefaultApps -ExecutablePath ${literal(missingExecutable)} -DryRun`,
  ].join('\r\n');
  await assert.rejects(execute(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text',
    '-Command', command,
  ], { windowsHide: true, shell: false, timeout: 10000, maxBuffer: 256 * 1024, encoding: 'utf8' }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /MD\.exe does not exist:/);
    assert.ok(error.stderr.replace(/\r?\n/g, '').includes(missingExecutable), 'the UTF-8-decoded diagnostic must retain the exact Unicode executable path');
    assert.doesNotMatch(error.stderr, /\ufffd/);
    return true;
  });
});
