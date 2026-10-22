import { packager } from '@electron/packager';
import { copyFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { configurePackagedFuses } from './package-fuses.mjs';
import { stageApplication } from './package-stage.mjs';

const sourceMetadata = JSON.parse(await readFile('package.json', 'utf8'));
const electronVersion = sourceMetadata.devDependencies.electron;
const stage = await stageApplication({ project: process.cwd(), platform: 'win32', arch: 'x64' });
const zipRoot = path.resolve('../electron-cache');
const apps = await packager({ dir: stage, out: path.resolve('.packaged'), name: 'MD', platform: 'win32', arch: 'x64', electronVersion, ...(existsSync(path.join(zipRoot, `electron-v${electronVersion}-win32-x64.zip`)) ? { electronZipDir: zipRoot } : {}), icon: path.resolve('assets/icon.ico'), overwrite: true, asar: false, prune: false,
  win32metadata: { CompanyName: 'MD', FileDescription: 'MD — Markdown 阅读与可视化编辑器', ProductName: 'MD', InternalName: 'MD', OriginalFilename: 'MD.exe' }, download: { cacheRoot: path.resolve('../electron-cache') }, });
for (const location of apps) {
  await configurePackagedFuses(path.join(location, 'MD.exe'));
  // The application offers Chinese and English. Keep both resource packs for
  // Chromium's locale fallback; Unicode document content remains independent
  // of the language used by Chromium's internal UI.
  const locales = path.join(location, 'locales');
  for (const entry of await readdir(locales, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.pak') && !['en-US.pak', 'zh-CN.pak'].includes(entry.name)) {
      await rm(path.join(locales, entry.name));
    }
  }
  for (const name of ['windows-integration.ps1', 'Register-MD.cmd', 'Unregister-MD.cmd']) await copyFile(path.join('scripts', name), path.join(location, name));
  console.log(location);
}
