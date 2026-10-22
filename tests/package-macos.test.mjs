import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { parseMacPackagingArgs, macPackagerOptions, macArtifactName, packageStagePath } from '../scripts/package-macos-config.mjs';
import { resetPackageStage } from '../scripts/package-stage.mjs';

test('macOS packaging selects each requested architecture without depending on the build host CPU', () => {
  assert.deepEqual(parseMacPackagingArgs(['--arch', 'arm64'], { platform: 'darwin', arch: 'x64' }), { arch: 'arm64', unsignedDir: false });
  assert.deepEqual(parseMacPackagingArgs(['--arch=x64'], { platform: 'darwin', arch: 'arm64' }), { arch: 'x64', unsignedDir: false });
  assert.deepEqual(parseMacPackagingArgs([], { platform: 'darwin', arch: 'arm64' }), { arch: 'arm64', unsignedDir: false });
});

test('non-Mac hosts require an explicit unsigned structure-only build and cannot pretend to produce a runnable release', () => {
  assert.throws(() => parseMacPackagingArgs(['--arch', 'arm64'], { platform: 'win32', arch: 'x64' }), /macOS/);
  assert.deepEqual(parseMacPackagingArgs(['--arch', 'arm64', '--unsigned-dir'], { platform: 'win32', arch: 'x64' }), { arch: 'arm64', unsignedDir: true });
});

test('invalid architectures, ambiguous arguments and path injection are rejected before packaging writes files', () => {
  for (const args of [['--arch'], ['--arch', 'universal'], ['--arch', '../escape'], ['--arch', 'arm64', '--arch', 'x64'], ['--publish']]) {
    assert.throws(() => parseMacPackagingArgs(args, { platform: 'darwin', arch: 'arm64' }));
  }
  const project = path.resolve('fixture-project');
  assert.equal(packageStagePath(project, 'darwin', 'arm64'), path.join(project, '.package-stage', 'darwin-arm64'));
  assert.throws(() => packageStagePath(project, '..', 'arm64'));
  assert.throws(() => packageStagePath(project, 'darwin', '../escape'));
});

test('packager receives a Mac bundle with editor associations and the actual Electron 44 OS floor', () => {
  const project = path.resolve('fixture-project');
  const options = macPackagerOptions({ project, arch: 'x64', electronVersion: '44.5.1' });
  assert.equal(options.platform, 'darwin');
  assert.equal(options.arch, 'x64');
  assert.equal(options.name, 'MD');
  assert.equal(options.icon, path.join(project, 'assets', 'icon.icns'));
  assert.equal(options.extendInfo.LSMinimumSystemVersion, '13.0');
  assert.equal(options.appBundleId, 'io.github.akinarit.md');
  assert.equal(options.extendInfo.NSHighResolutionCapable, true);
  assert.ok(options.extendInfo.CFBundleDocumentTypes.every(type => type.CFBundleTypeIconFile === options.extendInfo.CFBundleIconFile));
  assert.equal(options.asar, false);
  const types = options.extendInfo.CFBundleDocumentTypes;
  assert.deepEqual(types.flatMap(type => type.CFBundleTypeExtensions), ['md', 'markdown', 'mdmap']);
  assert.ok(types.every(type => type.CFBundleTypeRole === 'Editor' && type.LSHandlerRank === 'Alternate'));
  assert.equal(options.extendInfo.UTExportedTypeDeclarations[0].UTTypeIdentifier, 'io.github.akinarit.md.mindmap');
  assert.deepEqual(options.extendInfo.UTExportedTypeDeclarations[0].UTTypeTagSpecification['public.filename-extension'], ['mdmap']);
  assert.equal(options.osxSign, undefined, 'All content and fuse changes must finish before final ad-hoc signing.');
});

test('release artifact names distinguish architecture and version and reject path traversal', () => {
  assert.equal(macArtifactName('arm64', '0.1.31', 'zip'), 'MD-macOS-arm64-0.1.31.zip');
  assert.equal(macArtifactName('x64', '0.1.31', 'dmg'), 'MD-macOS-x64-0.1.31.dmg');
  assert.throws(() => macArtifactName('arm64', '../escape', 'zip'));
  assert.throws(() => macArtifactName('universal', '0.1.31', 'zip'));
  assert.throws(() => macArtifactName('x64', '0.1.31', '../escape'));
});

test('resetting one packaging stage removes stale files without deleting another architecture or following a linked stage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'md-stage-test-'));
  try {
    const project = path.join(directory, 'project');
    const outside = path.join(directory, 'outside');
    await mkdir(project); await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'preserve');
    const other = await resetPackageStage(project, 'darwin', 'x64');
    await writeFile(path.join(other, 'keep.txt'), 'other architecture');
    const stage = await resetPackageStage(project, 'darwin', 'arm64');
    await writeFile(path.join(stage, 'stale.txt'), 'stale');
    assert.equal(await resetPackageStage(project, 'darwin', 'arm64'), stage);
    await assert.rejects(readFile(path.join(stage, 'stale.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(other, 'keep.txt'), 'utf8'), 'other architecture');
    await rm(stage, { recursive: true });
    await symlink(outside, stage, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resetPackageStage(project, 'darwin', 'arm64'), /symbolic link/i);
    assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'preserve');
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
