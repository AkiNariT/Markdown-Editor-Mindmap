import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenArguments } from '../src/open-queue.mjs';
import { applicationLaunchContext, secondInstanceWorkingDirectory } from '../src/application-launch.mjs';

const runtime = 'C:\\Users\\user\\AppData\\Local\\Temp\\ns123.tmp\\app\\MD.exe';
const launcher = "C:\\Users\\user\\Desktop\\我的 MD (1) & ' 编辑器.exe";
const cwd = 'C:\\文档\\正在阅读';
const env = { PORTABLE_EXECUTABLE_FILE: launcher, MD_PORTABLE_CWD: cwd, MD_PORTABLE_RUNTIME: runtime };
function context(overrides = {}) {
  return applicationLaunchContext({ platform: 'win32', isPackaged: true, executablePath: runtime, cwd: 'C:\\临时目录', env, ...overrides });
}

test('a copied or renamed single-file app exposes the durable launcher and original document directory', () => {
  assert.deepEqual(context(), { executablePath: launcher, runtimeExecutablePath: runtime, cwd, portable: true });
  // Argument resolution uses the host filesystem; this fixture models the
  // Windows-only portable launcher, whose paths have no meaning on macOS.
  if (process.platform === 'win32') assert.deepEqual(parseOpenArguments(['笔记.md', '导图.mdmap'], context().cwd), ['C:\\文档\\正在阅读\\笔记.md', 'C:\\文档\\正在阅读\\导图.mdmap']);
});

test('ordinary directory packages and development ignore portable-only variables', () => {
  for (const overrides of [{ env: {} }, { isPackaged: false }, { platform: 'darwin' }]) {
    assert.deepEqual(context(overrides), { executablePath: runtime, runtimeExecutablePath: runtime, cwd: 'C:\\临时目录', portable: false });
  }
});

test('unrelated portable environments cannot redirect an ordinary MD registration or document directory', () => {
  for (const inherited of [
    { PORTABLE_EXECUTABLE_FILE: 'C:\\Other\\other.exe', MD_PORTABLE_CWD: 'C:\\Other' },
    { ...env, MD_PORTABLE_RUNTIME: 'C:\\Other\\MD.exe' },
    { ...env, MD_PORTABLE_RUNTIME: 'MD.exe' },
  ]) {
    assert.deepEqual(context({ env: inherited }), { executablePath: runtime, runtimeExecutablePath: runtime, cwd: 'C:\\临时目录', portable: false });
  }
});

test('malformed launcher metadata never exposes the temporary runtime for persistent registration', () => {
  for (const target of ['MD.exe', '\\folder\\MD.exe', 'C:MD.exe', 'C:\\Desktop\\app.cmd', 'C:\\Desktop\\bad".exe', 'C:\\Desktop\\bad\n.exe', 'C:\\Desktop\\file:stream.exe']) {
    assert.equal(context({ env: { ...env, PORTABLE_EXECUTABLE_FILE: target } }).executablePath, null, target);
  }
});

test('each second instance carries its own original directory rather than the first launcher directory', () => {
  const next = context({ env: { ...env, MD_PORTABLE_CWD: 'D:\\另一个目录' } });
  const received = secondInstanceWorkingDirectory({ cwd: next.cwd }, 'C:\\Temp\\second-runtime', 'win32');
  assert.equal(received, 'D:\\另一个目录');
  if (process.platform === 'win32') assert.deepEqual(parseOpenArguments(['第二份.md'], received), ['D:\\另一个目录\\第二份.md']);
  for (const value of [null, {}, { cwd: 'relative' }, { cwd: 'C:\\bad\npath' }, { cwd: '\\drive-relative' }]) {
    assert.equal(secondInstanceWorkingDirectory(value, 'C:\\fallback', 'win32'), 'C:\\fallback');
  }
});
