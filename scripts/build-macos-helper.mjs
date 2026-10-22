import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { macMinimumVersion, parseMacPackagingArgs } from './package-macos-config.mjs';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));

export async function buildMacRenameHelper({ arch = process.arch, output = path.join(project, 'build/macos/md-rename') } = {}) {
  parseMacPackagingArgs(['--arch', arch]);
  const target = path.resolve(output);
  const relative = path.relative(project, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Native helper output must be inside this project.');
  await mkdir(path.dirname(target), { recursive: true });
  await execute('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', `-mmacosx-version-min=${macMinimumVersion}`, path.join(project, 'scripts/macos-rename.c'), '-o', target]);
  await chmod(target, 0o755);
  await execute('codesign', ['--sign', '-', '--force', target]);
  await execute('codesign', ['--verify', '--strict', target]);
  console.log(target);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { arch, unsignedDir } = parseMacPackagingArgs(process.argv.slice(2));
  if (unsignedDir) throw new Error('The native rename helper must be compiled on macOS.');
  await buildMacRenameHelper({ arch });
}
