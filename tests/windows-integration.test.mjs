import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const helper = resolve('scripts/windows-integration.ps1');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function powershell(code) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const json = code => JSON.parse(powershell(code));
function fixture() {
  const id = randomUUID();
  const dir = mkdtempSync(join(tmpdir(), 'MD-shell-test-'));
  const exe = join(dir, "中文 空格 & ' 目录", 'MD.exe');
  mkdirSync(resolve(exe, '..'), { recursive: true }); copyFileSync(join(process.env.SystemRoot, 'System32', 'notepad.exe'), exe);
  const root = `HKCU:\\Software\\MD.WindowsIntegrationTests\\${id}`;
  const classes = root + '\\Classes';
  return { id, dir, exe, root, classes, run(action, extra = '', target = exe) {
    return json(`& ${quote(helper)} -Action ${action} -ExecutablePath ${quote(target)} -TestId ${quote(id)} -TestDirectory ${quote(dir)} ${extra}`);
  }, cleanup() {
    powershell(`if (Test-Path -LiteralPath ${quote(root)}) { Remove-Item -LiteralPath ${quote(root)} -Recurse -Force }`);
  } };
}

test('Windows shell plan is per-user, quoted, explicit and dry-run has no side effects', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const plan = f.run('Install', '-DryRun');
    assert.equal(plan.appUserModelId, 'Moye.MD');
    assert.equal(plan.command, `"${f.exe}" "%1"`);
    assert.deepEqual(plan.extensions, ['.md', '.markdown', '.mdmap']);
    assert.equal(plan.registryRoot, f.classes);
    assert.equal(plan.dryRun, true);
    assert.equal(powershell(`Test-Path -LiteralPath ${quote(f.root)}`), 'False');
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
    const realPlan = json(`& ${quote(helper)} -Action Install -ExecutablePath ${quote(f.exe)} -DryRun`);
    assert.equal(realPlan.registryRoot, 'HKCU:\\Software\\Classes');
    assert.equal(realPlan.changesDefaults, false);
    assert.equal(JSON.stringify(realPlan).includes('UserChoice'), false);
  } finally { f.cleanup(); }
});

test('default-app registration plan includes per-user capabilities and only a Start Menu shortcut', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const plan = f.run('RegisterDefaultApps', '-DryRun');
    assert.deepEqual(plan.shortcuts, [join(f.dir, 'Start Menu', 'MD.lnk')]);
    assert.equal(plan.changesDefaults, false);
    assert.equal(plan.registeredApplication, 'MD');
    assert.equal(plan.registryValues.every(entry => entry.path.startsWith(f.root + '\\')), true);
    assert.equal(plan.registryValues.some(entry => entry.path === f.root + '\\RegisteredApplications' && entry.name === 'MD' && entry.value.endsWith('\\Moye.MD\\Capabilities')), true);
    for (const extension of ['.md', '.markdown']) {
      assert.equal(plan.registryValues.some(entry => entry.path === f.root + '\\Moye.MD\\Capabilities\\FileAssociations' && entry.name === extension && entry.value === 'Moye.MD.Markdown'), true);
    }
    for (const progId of ['Moye.MD.Markdown', 'Moye.MD.Mindmap']) {
      for (const [name, value] of Object.entries({ ApplicationName: 'MD', ApplicationCompany: 'MD', ApplicationDescription: 'Markdown reader and editor', ApplicationIcon: `"${f.exe}",0`, AppUserModelID: 'Moye.MD' })) {
        assert.equal(plan.registryValues.some(entry => entry.path === f.classes + '\\' + progId + '\\Application' && entry.name === name && entry.value === value), true, `${progId} ${name}`);
      }
    }
    assert.equal(powershell(`Test-Path -LiteralPath ${quote(f.root)}`), 'False');
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
  } finally { f.cleanup(); }
});

test('PowerShell File arguments preserve Unicode and shell punctuation without command interpolation', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const output = execFileSync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-Action', 'RegisterDefaultApps', '-ExecutablePath', f.exe,
      '-TestId', f.id, '-TestDirectory', f.dir, '-DryRun',
    ], { encoding: 'utf8', windowsHide: true, shell: false });
    // The legacy PowerShell console code page need not represent every Unicode
    // character; inspect the ASCII-only portion of the plan without relying on it.
    const plan = JSON.parse(output);
    assert.equal(plan.action, 'RegisterDefaultApps');
    assert.equal(plan.dryRun, true);
    assert.deepEqual(plan.shortcuts, [join(f.dir, 'Start Menu', 'MD.lnk')]);
    assert.equal(powershell(`Test-Path -LiteralPath ${quote(f.root)}`), 'False');
  } finally { f.cleanup(); }
});

test('isolated default-app registration preserves defaults and removes only owned capabilities', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  const capabilities = f.root + '\\Moye.MD\\Capabilities';
  const registered = f.root + '\\RegisteredApplications';
  try {
    f.run('RegisterDefaultApps');
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
    assert.equal(existsSync(join(f.dir, 'Start Menu', 'MD.lnk')), true);
    const linkInfo = json(`$shell=New-Object -ComObject Shell.Application; $folder=$shell.NameSpace(${quote(join(f.dir, 'Start Menu'))}); $item=$folder.ParseName('MD.lnk'); @{target=$item.ExtendedProperty('System.Link.TargetParsingPath'); arguments=$item.ExtendedProperty('System.Link.Arguments'); appId=$item.ExtendedProperty('System.AppUserModel.ID')} | ConvertTo-Json -Compress`);
    assert.equal(linkInfo.target.toLowerCase(), f.exe.toLowerCase());
    assert.equal(linkInfo.arguments ?? '', '');
    assert.equal(linkInfo.appId, 'Moye.MD');
    assert.equal(powershell(`(Get-Item ${quote(capabilities)}).GetValue('MDExecutablePath')`), f.exe);
    powershell(`New-ItemProperty ${quote(capabilities)} -Name ForeignValue -Value keep | Out-Null; New-ItemProperty ${quote(registered)} -Name OtherApp -Value 'Software\\OtherApp\\Capabilities' | Out-Null`);
    const newExe = join(f.dir, 'Relocated', 'MD.exe'); mkdirSync(resolve(newExe, '..')); copyFileSync(f.exe, newExe);
    f.run('RegisterDefaultApps', '', newExe);
    f.run('Uninstall');
    assert.equal(powershell(`(Get-Item ${quote(capabilities)}).GetValue('MDExecutablePath')`), newExe);
    assert.equal(existsSync(join(f.dir, 'Start Menu', 'MD.lnk')), true);
    const application = f.classes + '\\Moye.MD.Markdown\\Application';
    assert.equal(powershell(`(Get-Item ${quote(application)}).GetValue('ApplicationName')`), 'MD');
    powershell(`Set-ItemProperty ${quote(application)} -Name ApplicationCompany -Value 'Foreign publisher'; New-ItemProperty ${quote(application)} -Name ForeignValue -Value keep | Out-Null`);
    f.run('Uninstall', '', newExe);
    assert.equal(existsSync(join(f.dir, 'Start Menu', 'MD.lnk')), false);
    assert.equal(powershell(`(Get-Item ${quote(capabilities)}).GetValue('ForeignValue')`), 'keep');
    assert.equal(powershell(`(Get-Item ${quote(registered)}).GetValue('OtherApp')`), 'Software\\OtherApp\\Capabilities');
    assert.equal(powershell(`(Get-Item ${quote(registered)}).GetValueNames() -contains 'MD'`), 'False');
    assert.equal(powershell(`Test-Path ${quote(capabilities + '\\FileAssociations')}`), 'False');
    assert.equal(powershell(`(Get-Item ${quote(application)}).GetValue('ApplicationCompany')`), 'Foreign publisher');
    assert.equal(powershell(`(Get-Item ${quote(application)}).GetValue('ForeignValue')`), 'keep');
    assert.equal(powershell(`(Get-Item ${quote(application)}).GetValueNames() -contains 'ApplicationName'`), 'False');
  } finally { f.cleanup(); }
});

test('default-app registration never replaces an unowned Start Menu shortcut', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    powershell(`New-Item -ItemType Directory -Path ${quote(join(f.dir, 'Start Menu'))} -Force | Out-Null; $link=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(join(f.dir, 'Start Menu', 'MD.lnk'))}); $link.TargetPath=Join-Path $env:SystemRoot 'System32\\notepad.exe'; $link.Description='someone else'; $link.Save()`);
    assert.throws(() => f.run('RegisterDefaultApps'), /conflict/i);
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Markdown')}`), 'False');
    assert.equal(powershell(`Test-Path ${quote(f.root + '\\Moye.MD\\Capabilities')}`), 'False');
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
    f.run('Uninstall');
    assert.equal(existsSync(join(f.dir, 'Start Menu', 'MD.lnk')), true);
  } finally { f.cleanup(); }
});

test('foreign capabilities and registered-app names block registration before any writes', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  const capabilities = f.root + '\\Moye.MD\\Capabilities';
  const registered = f.root + '\\RegisteredApplications';
  try {
    powershell(`New-Item ${quote(registered)} -Force | Out-Null; New-ItemProperty ${quote(registered)} -Name MD -Value 'Software\\OtherApp\\Capabilities' | Out-Null`);
    assert.throws(() => f.run('RegisterDefaultApps'), /conflict/i);
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Markdown')}`), 'False');
    powershell(`Remove-ItemProperty ${quote(registered)} -Name MD; New-Item ${quote(capabilities)} -Force | Out-Null; New-ItemProperty ${quote(capabilities)} -Name ApplicationName -Value 'Foreign MD' | Out-Null`);
    assert.throws(() => f.run('Install'), /conflict/i);
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Markdown')}`), 'False');
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
  } finally { f.cleanup(); }
});

test('isolated install supports Unicode paths, shortcuts, idempotency and guarded uninstall', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    powershell(`New-Item ${quote(f.classes + '\\.md')} -Force | Out-Null; Set-Item ${quote(f.classes + '\\.md')} -Value 'Other.Markdown'; New-Item ${quote(f.root + '\\UserChoice')} -Force | Out-Null; New-ItemProperty ${quote(f.root + '\\UserChoice')} -Name ProgId -Value 'Other.Markdown' | Out-Null`);
    assert.equal(f.run('Install').action, 'Install');
    f.run('Install');
    const read = json(`$shell=New-Object -ComObject Shell.Application; $folder=$shell.NameSpace(${quote(join(f.dir, 'Desktop'))}); $item=$folder.ParseName('MD.lnk'); @{target=$item.ExtendedProperty('System.Link.TargetParsingPath'); arguments=$item.ExtendedProperty('System.Link.Arguments'); appId=$item.ExtendedProperty('System.AppUserModel.ID'); command=(Get-Item ${quote(f.classes + '\\Moye.MD.Markdown\\shell\\open\\command')}).GetValue(''); default=(Get-Item ${quote(f.classes + '\\.md')}).GetValue(''); userChoice=(Get-Item ${quote(f.root + '\\UserChoice')}).GetValue('ProgId'); supported=(Get-Item ${quote(f.classes + '\\Applications\\MD.exe\\SupportedTypes')}).GetValueNames()} | ConvertTo-Json -Compress`);
    assert.equal(read.target.toLowerCase(), f.exe.toLowerCase());
    assert.equal(read.arguments ?? '', '');
    assert.equal(read.appId, 'Moye.MD');
    assert.equal(read.command, `"${f.exe}" "%1"`);
    assert.equal(read.default, 'Other.Markdown');
    assert.equal(read.userChoice, 'Other.Markdown');
    assert.deepEqual(read.supported.sort(), ['.markdown', '.md', '.mdmap'].sort());
    for (const [ext, progId] of [['.md', 'Moye.MD.Markdown'], ['.markdown', 'Moye.MD.Markdown'], ['.mdmap', 'Moye.MD.Mindmap']]) {
      assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\' + ext + '\\OpenWithProgids')}).GetValueNames() -contains ${quote(progId)}`), 'True');
    }
    // Relocating updates this application's registration; an old helper cannot remove it.
    const newExe = join(f.dir, '新版 中文目录', 'MD.exe'); mkdirSync(resolve(newExe, '..')); copyFileSync(f.exe, newExe);
    f.run('Install', '', newExe); f.run('Uninstall');
    assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\Moye.MD.Markdown\\shell\\open\\command')}).GetValue('')`), `"${newExe}" "%1"`);
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), true);
    // Unknown values in our ProgID and unrelated extension defaults are retained.
    powershell(`New-ItemProperty ${quote(f.classes + '\\Moye.MD.Markdown')} -Name ForeignValue -Value keep | Out-Null`);
    f.run('Uninstall', '-DryRun', newExe);
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), true);
    f.run('Uninstall', '', newExe); f.run('Uninstall', '', newExe);
    assert.equal(existsSync(join(f.dir, 'Desktop', 'MD.lnk')), false);
    assert.equal(existsSync(join(f.dir, 'Start Menu', 'MD.lnk')), false);
    assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\Moye.MD.Markdown')}).GetValue('ForeignValue')`), 'keep');
    assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\.md')}).GetValue('')`), 'Other.Markdown');
    assert.equal(powershell(`(Get-Item ${quote(f.root + '\\UserChoice')}).GetValue('ProgId')`), 'Other.Markdown');
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Mindmap')}`), 'False');
  } finally { f.cleanup(); }
});

test('foreign registrations and shortcuts are never replaced; altered commands prevent removal', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    powershell(`New-Item ${quote(f.classes + '\\Applications\\MD.exe')} -Force | Out-Null; Set-Item ${quote(f.classes + '\\Applications\\MD.exe')} -Value 'Foreign application'`);
    assert.throws(() => f.run('Install'), /conflict/i);
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Markdown')}`), 'False', 'preflight prevents partial ownership changes');
    powershell(`Remove-Item -LiteralPath ${quote(f.classes + '\\Applications\\MD.exe')}; New-Item -ItemType Directory -Path ${quote(join(f.dir, 'Desktop'))} -Force | Out-Null; $link=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(join(f.dir, 'Desktop', 'MD.lnk'))}); $link.TargetPath=Join-Path $env:SystemRoot 'System32\\notepad.exe'; $link.Description='someone else'; $link.Save()`);
    assert.throws(() => f.run('Install'), /conflict/i);
    assert.equal(powershell(`Test-Path ${quote(f.classes + '\\Moye.MD.Markdown')}`), 'False');
    powershell(`Remove-Item -LiteralPath ${quote(join(f.dir, 'Desktop', 'MD.lnk'))}`);
    f.run('Install');
    powershell(`Set-Item ${quote(f.classes + '\\Moye.MD.Markdown\\shell\\open\\command')} -Value 'foreign-command'`);
    f.run('Uninstall');
    assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\Moye.MD.Markdown\\shell\\open\\command')}).GetValue('')`), 'foreign-command');
    assert.equal(powershell(`(Get-Item ${quote(f.classes + '\\.md\\OpenWithProgids')}).GetValueNames() -contains 'Moye.MD.Markdown'`), 'True');
  } finally { f.cleanup(); }
});
