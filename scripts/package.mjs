import { build } from 'esbuild';
import { packager } from '@electron/packager';
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const stage = path.resolve('.package-stage');
// Start from a clean, fixed workspace child so retired modules cannot leak
// into a later release when the stage directory is reused.
if (path.dirname(stage) !== process.cwd()) throw new Error('Unexpected packaging stage path');
await rm(stage, { recursive: true, force: true });
await import('./notices.mjs');
for (const directory of ['', 'electron', 'src', 'dist', 'assets', 'assets/templates']) await mkdir(path.join(stage, directory), { recursive: true });
for (const name of ['index.html', 'electron/preload.cjs', 'src/files.mjs', 'dist/app.js', 'dist/style.css', 'assets/icon.svg', 'assets/icon.ico', 'assets/templates/SKILL.md', 'assets/templates/SKILL.en.md', 'README.txt', 'README.en.txt', '示例.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(name, path.join(stage, name));
// Bundle every library, while leaving Electron and built-in Node APIs external.
await build({ entryPoints: ['electron/main.cjs'], bundle: true, outfile: path.join(stage, 'electron/main.cjs'), platform: 'node', format: 'cjs', external: ['electron'], target: 'node24', legalComments: 'eof' });
// Keep one locale instance across separately bundled main-process modules.
for (const name of ['i18n', 'settings', 'document', 'images', 'mindmap', 'mindmap-files', 'mindmap-create', 'recovery', 'window-state', 'open-queue']) await build({ entryPoints: [`src/${name}.mjs`], bundle: true, outfile: path.join(stage, `src/${name}.mjs`), platform: 'node', format: 'esm', target: 'node24', external: ['./i18n.mjs'], legalComments: 'eof',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, });
const sourceMetadata = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'moye', productName: 'MD', version: sourceMetadata.version, main: 'electron/main.cjs', type: 'module', description: '极简 Markdown 阅读与可视化编辑器', author: 'MD', license: 'MIT' }, null, 2));
const zipRoot = path.resolve('../electron-cache');
const apps = await packager({ dir: stage, out: path.resolve('.packaged'), name: 'MD', platform: 'win32', arch: 'x64', electronVersion: '44.5.1', ...(existsSync(path.join(zipRoot, 'electron-v44.5.1-win32-x64.zip')) ? { electronZipDir: zipRoot } : {}), icon: path.resolve('assets/icon.ico'), overwrite: true, asar: false, prune: false,
  win32metadata: { CompanyName: 'MD', FileDescription: 'MD — Markdown 阅读与可视化编辑器', ProductName: 'MD', InternalName: 'MD', OriginalFilename: 'MD.exe' }, download: { cacheRoot: path.resolve('../electron-cache') }, });
for (const location of apps) {
  for (const name of ['windows-integration.ps1', 'Register-MD.cmd', 'Unregister-MD.cmd']) await copyFile(path.join('scripts', name), path.join(location, name));
  console.log(location);
}
