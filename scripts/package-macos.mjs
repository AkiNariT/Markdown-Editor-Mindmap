import { packager } from '@electron/packager';
import { build, Platform, Arch } from 'electron-builder';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { stageApplication } from './package-stage.mjs';
import { configurePackagedFuses } from './package-fuses.mjs';
import { buildMacRenameHelper } from './build-macos-helper.mjs';
import { macArtifactName, macBundleId, macMinimumVersion, macPackagerOptions, parseMacPackagingArgs } from './package-macos-config.mjs';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
// Validate before writing the staging directory or downloading the runtime.
const { arch, unsignedDir } = parseMacPackagingArgs(process.argv.slice(2));
const metadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const electronVersion = metadata.devDependencies.electron;
const expectedArchitecture = arch === 'x64' ? 'x86_64' : 'arm64';
const output = path.join(project, '.packaged', 'macos', arch);
const icon = path.join(project, 'assets/icon.icns');
await access(icon);
await stageApplication({ project, platform: 'darwin', arch });
const zipRoot = path.resolve(project, '../electron-cache');
const apps = await packager({
  ...macPackagerOptions({ project, arch, electronVersion }),
  ...(unsignedDir ? { out: path.join(project, '.packaged/unsigned-macos') } : {}),
  ...(existsSync(path.join(zipRoot, `electron-v${electronVersion}-darwin-${arch}.zip`)) ? { electronZipDir: zipRoot } : {}),
  download: { cacheRoot: zipRoot },
});
if (apps.length !== 1) throw new Error('Expected exactly one macOS application bundle.');
const appPath = path.join(apps[0], 'MD.app');

async function verifyApplication(bundle) {
  const plistPath = path.join(bundle, 'Contents/Info.plist');
  const { stdout } = await execute('plutil', ['-convert', 'json', '-o', '-', plistPath]);
  const plist = JSON.parse(stdout);
  if (plist.CFBundleIdentifier !== macBundleId || plist.CFBundleShortVersionString !== metadata.version || plist.LSMinimumSystemVersion !== macMinimumVersion) throw new Error('Packaged application identity, version or minimum OS is incorrect.');
  const extensions = plist.CFBundleDocumentTypes.flatMap(type => type.CFBundleTypeExtensions).sort();
  if (JSON.stringify(extensions) !== JSON.stringify(['markdown', 'md', 'mdmap'])) throw new Error('Packaged Finder document associations are incomplete.');
  await access(path.join(bundle, 'Contents/Resources', plist.CFBundleIconFile));
  for (const binary of ['Contents/MacOS/MD', 'Contents/Resources/md-rename', 'Contents/Frameworks/Electron Framework.framework/Electron Framework']) {
    const result = await execute('lipo', ['-archs', path.join(bundle, binary)]);
    if (result.stdout.trim() !== expectedArchitecture) throw new Error(`Unexpected CPU architecture in ${binary}: ${result.stdout.trim()}`);
  }
  const fuses = await getCurrentFuseWire(bundle);
  for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.OnlyLoadAppFromAsar]) {
    if (fuses[option] !== 48) throw new Error('Packaged Electron fuse configuration is incorrect.');
  }
  await execute('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  const signature = await execute('codesign', ['--display', '--verbose=4', bundle]);
  if (!`${signature.stdout}\n${signature.stderr}`.includes('Signature=adhoc')) throw new Error('Expected an explicitly ad-hoc signed preview.');
}

async function verifyArchives(zipFile, dmgFile) {
  // Work only in a newly created output child. ZIP extraction must preserve
  // framework symlinks and executable bits, or codesign verification fails.
  const temporary = await mkdtemp(path.join(output, 'verify-'));
  const mounted = path.join(temporary, 'dmg');
  let attached = false;
  try {
    const extracted = path.join(temporary, 'zip');
    await mkdir(extracted);
    await execute('ditto', ['-x', '-k', zipFile, extracted]);
    await verifyApplication(path.join(extracted, 'MD.app'));
    await execute('hdiutil', ['verify', dmgFile]);
    await mkdir(mounted);
    await execute('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mounted, dmgFile]);
    attached = true;
    await verifyApplication(path.join(mounted, 'MD.app'));
    if (await readlink(path.join(mounted, 'Applications')) !== '/Applications') throw new Error('DMG Applications shortcut is missing.');
  } finally {
    if (attached) await execute('hdiutil', ['detach', mounted]);
    if (path.dirname(temporary) !== output) throw new Error('Unexpected archive verification path.');
    await rm(temporary, { recursive: true, force: true });
  }
}

async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

if (unsignedDir) {
  // Cross-host output deliberately never enters the release directory. The
  // native helper, fuse mutation and signature cannot be completed on Windows.
  await writeFile(path.join(apps[0], 'STRUCTURE-ONLY-NOT-FOR-DISTRIBUTION.txt'),
    'Incomplete macOS structure inspection only.\nNo native rename helper, final fuse configuration, signing or launch validation was performed.\nBuild on macOS to produce a runnable preview.\n');
  console.log(`STRUCTURE ONLY; NOT FOR DISTRIBUTION: ${appPath}`);
} else {
  await buildMacRenameHelper({ arch, output: path.join(appPath, 'Contents/Resources/md-rename') });
  // All mutations must precede the last signature. This restores the modified
  // Electron Framework and seals the .app, preserving Electron entitlements.
  await configurePackagedFuses(appPath, { resetAdHocDarwinSignature: true });
  await verifyApplication(appPath);
  await mkdir(output, { recursive: true });
  await build({
    projectDir: project, prepackaged: appPath,
    targets: Platform.MAC.createTarget(['zip', 'dmg'], Arch[arch]), publish: 'never',
    config: {
      appId: macBundleId, productName: 'MD', electronVersion,
      directories: { output, buildResources: 'assets' },
      artifactName: `MD-macOS-${arch}-${metadata.version}.\${ext}`,
      npmRebuild: false, publish: null,
      // prepackaged skips app mutation/signing in electron-builder. We have
      // already sealed and verified the exact bundle supplied above.
      mac: { identity: null, notarize: false, icon, minimumSystemVersion: macMinimumVersion },
      dmg: {
        sign: false, writeUpdateInfo: false, icon, backgroundColor: '#ffffff',
        contents: [{ x: 130, y: 220, type: 'file', path: appPath }, { x: 410, y: 220, type: 'link', path: '/Applications' }],
      },
    },
  });
  const zipFile = path.join(output, macArtifactName(arch, metadata.version, 'zip'));
  const dmgFile = path.join(output, macArtifactName(arch, metadata.version, 'dmg'));
  await verifyArchives(zipFile, dmgFile);
  const artifacts = [];
  for (const file of [zipFile, dmgFile]) artifacts.push({ name: path.basename(file), sha256: await hashFile(file) });
  const stem = `MD-macOS-${arch}-${metadata.version}`;
  await writeFile(path.join(output, `${stem}.sha256`), artifacts.map(item => `${item.sha256}  ${item.name}\n`).join(''));
  await writeFile(path.join(output, `${stem}.build.json`), JSON.stringify({
    product: 'MD', version: metadata.version, electronVersion, platform: 'darwin', arch,
    minimumSystemVersion: macMinimumVersion, signature: 'ad-hoc', developerIdSigned: false, notarized: false,
    sourceCommit: process.env.GITHUB_SHA || null, buildOS: os.release(), builtAt: new Date().toISOString(),
    verified: ['bundle metadata', 'binary architectures', 'Electron fuses', 'ad-hoc signature', 'ZIP extraction', 'DMG mount and Applications shortcut'], artifacts,
  }, null, 2) + '\n');
  console.log(`Ad-hoc signed preview, without Developer ID signing or notarization: ${appPath}`);
  for (const artifact of artifacts) console.log(path.join(output, artifact.name));
}
