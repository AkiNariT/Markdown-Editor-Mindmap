import { build } from 'esbuild';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { packageStagePath } from './package-macos-config.mjs';

const execute = promisify(execFile);

export async function resetPackageStage(project, platform, arch) {
  const stage = packageStagePath(project, platform, arch);
  // Refuse junctions as well as symlinks before removing a generated directory.
  for (const candidate of [path.dirname(stage), stage]) {
    const info = await lstat(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isSymbolicLink()) throw new Error('Packaging stage must not be a symbolic link.');
    if (info && !info.isDirectory()) throw new Error('Packaging stage must be a directory.');
  }
  await mkdir(path.dirname(stage), { recursive: true });
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage);
  return stage;
}

export async function stageApplication({ project, platform, arch }) {
  project = path.resolve(project);
  const stage = await resetPackageStage(project, platform, arch);
  await execute(process.execPath, [path.join(project, 'scripts/notices.mjs')], { cwd: project, windowsHide: true });
  for (const directory of ['electron', 'src', 'dist', 'assets', 'assets/templates']) await mkdir(path.join(stage, directory), { recursive: true });
  const icons = platform === 'darwin' ? ['assets/icon.png', 'assets/icon.icns'] : ['assets/icon.ico'];
  for (const name of ['index.html', 'electron/preload.cjs', 'dist/app.js', 'dist/style.css', 'assets/icon.svg', ...icons, 'assets/templates/SKILL.md', 'assets/templates/SKILL.en.md', '示例.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    await copyFile(path.join(project, name), path.join(stage, name));
  }
  for (const [target, macSource] of [['README.txt', 'docs/README.macOS.txt'], ['README.en.txt', 'docs/README.macOS.en.txt']]) {
    await copyFile(path.join(project, platform === 'darwin' ? macSource : target), path.join(stage, target));
  }
  // Main-process static imports are bundled; dynamic runtime modules retain
  // one shared locale module instead of embedding their own language state.
  await build({ absWorkingDir: project, entryPoints: ['electron/main.cjs'], bundle: true, outfile: path.join(stage, 'electron/main.cjs'), platform: 'node', format: 'cjs', external: ['electron'], target: 'node24', legalComments: 'eof' });
  for (const name of ['files', 'i18n', 'settings', 'windows-default', 'updates', 'document', 'images', 'mindmap', 'mindmap-files', 'mindmap-create', 'mindmap-outline', 'mindmap-export', 'recovery', 'window-state', 'open-queue']) {
    await build({ absWorkingDir: project, entryPoints: [`src/${name}.mjs`], bundle: true, outfile: path.join(stage, `src/${name}.mjs`), platform: 'node', format: 'esm', target: 'node24', external: ['./i18n.mjs'], legalComments: 'eof',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, });
  }
  const sourceMetadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'moye', productName: 'MD', version: sourceMetadata.version, main: 'electron/main.cjs', type: 'module', description: sourceMetadata.description, author: 'MD', license: 'MIT' }, null, 2));
  return stage;
}
