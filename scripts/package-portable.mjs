import { build, Platform } from 'electron-builder';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(project, '.packaged', 'MD-win32-x64');
const metadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const packaged = JSON.parse(await readFile(path.join(input, 'resources/app/package.json'), 'utf8'));
if (packaged.version !== metadata.version) throw new Error('Build the current folder package before creating the single-file EXE.');
for (const file of ['MD.exe', 'icudtl.dat', 'windows-integration.ps1']) await access(path.join(input, file));
// Avoid the upstream default ultra-compression pass for a desktop-sized runtime.
// Level 5 keeps downloads compact while making local rebuilds practical.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '5';

// The supported custom NSIS script API lets us preserve caller cwd and use a
// separate extraction directory on every invocation. It performs no install.
// Keep this separate from the folder package used by existing ZIP downloads.
const artifacts = await build({
  projectDir: project,
  prepackaged: input,
  targets: Platform.WINDOWS.createTarget('nsis', 'x64'),
  publish: 'never',
  config: {
    appId: 'Moye.MD',
    productName: 'MD',
    electronVersion: '44.5.1',
    directories: { output: path.join(project, '.packaged', 'portable'), buildResources: 'assets' },
    artifactName: `MD-Windows-x64-${metadata.version}.exe`,
    npmRebuild: false,
    publish: null,
    win: { icon: 'assets/icon.ico', signExecutable: false, signAndEditExecutable: false },
    nsis: {
      script: 'scripts/portable.nsi',
      // The NSIS ZIP extractor checks its result directly and avoids the 7z
      // template's staging-copy/retry fallback on extraction errors.
      useZip: true,
      packElevateHelper: false,
      differentialPackage: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
    },
  },
});
for (const artifact of artifacts) console.log(artifact);
