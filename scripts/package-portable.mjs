import { build, Platform, Arch } from 'electron-builder';
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRuntimeFiles, runtimeFileChecks, runtimeHashChecks } from './portable-manifest.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(project, '.packaged', 'MD-win32-x64');
const metadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const packaged = JSON.parse(await readFile(path.join(input, 'resources/app/package.json'), 'utf8'));
if (packaged.version !== metadata.version) throw new Error('Build the current folder package before creating the single-file EXE.');
for (const file of ['MD.exe', 'icudtl.dat', 'windows-integration.ps1']) await access(path.join(input, file));
const output = path.join(project, '.packaged', 'portable');
await mkdir(output, { recursive: true });
const runtimeFiles = await collectRuntimeFiles(input, { hashes: true });
await writeFile(path.join(output, 'runtime-files.nsh'), runtimeFileChecks(runtimeFiles) + runtimeHashChecks(runtimeFiles), 'utf8');
// The intermediate archive supplies cache identity only; it is never embedded.
// Storing it uncompressed avoids an otherwise wasted packaging compression pass.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '0';

// The supported custom NSIS script API keeps caller cwd and immutable per-user
// runtime caches. Raw embedded files avoid ZIP staging and decompression on the
// first run. It performs no installation or file-association changes.
// Keep this separate from the folder package used by existing ZIP downloads.
const artifacts = await build({
  projectDir: project,
  prepackaged: input,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never',
  effectiveOptionComputed: async ([defines]) => {
    if (!/^[A-F0-9]{128}$/i.test(defines.APP_64_HASH ?? '')) throw new Error('Expected a complete SHA-512 payload hash from electron-builder.');
    if (JSON.stringify(await collectRuntimeFiles(input, { hashes: true })) !== JSON.stringify(runtimeFiles)) throw new Error('Runtime files changed during packaging. Rebuild the package.');
    console.log(`Portable payload SHA-512: ${defines.APP_64_HASH}`);
    return false;
  },
  config: {
    appId: 'Moye.MD',
    productName: 'MD',
    electronVersion: '44.5.1',
    directories: { output, buildResources: 'assets' },
    artifactName: `MD-Windows-x64-${metadata.version}.exe`,
    npmRebuild: false,
    publish: null,
    win: { icon: 'assets/icon.ico', signExecutable: false, signAndEditExecutable: false },
    nsis: {
      script: 'scripts/portable.nsi',
      // Builder supplies APP_64_HASH from this package for cache identity. The
      // custom launcher embeds the source files directly; no ZIP is extracted.
      useZip: true,
      packElevateHelper: false,
      differentialPackage: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
    },
  },
});
for (const artifact of artifacts) console.log(artifact);
