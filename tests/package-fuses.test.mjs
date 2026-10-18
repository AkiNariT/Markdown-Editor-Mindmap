import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { configurePackagedFuses } from '../scripts/package-fuses.mjs';

test('release fuse configuration disables environment-driven Node startup and preserves Electron loading/debugging', { skip: process.platform !== 'win32' }, async () => {
  const source = createRequire(import.meta.url)('electron');
  const original = await getCurrentFuseWire(source);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'md-packaging-fuses-'));
  const executable = path.join(directory, 'MD.exe');
  try {
    await copyFile(source, executable);
    await configurePackagedFuses(executable);
    const configured = await getCurrentFuseWire(executable);
    assert.equal(configured[FuseV1Options.RunAsNode], 48, 'Release must ignore ELECTRON_RUN_AS_NODE.');
    assert.equal(configured[FuseV1Options.EnableNodeOptionsEnvironmentVariable], 48, 'Release must ignore NODE_OPTIONS.');
    assert.equal(configured[FuseV1Options.OnlyLoadAppFromAsar], 48, 'Unpacked resources/app must remain loadable.');
    assert.equal(configured[FuseV1Options.EnableNodeCliInspectArguments], 49, 'Packaged Playwright tests still require the main-process inspector.');
    for (const option of Object.keys(original).filter(key => !['0', '2', '5'].includes(key))) {
      assert.equal(configured[option], original[option], `Unrelated fuse ${option} must be preserved, including newer unknown fuses.`);
    }
    await configurePackagedFuses(executable);
    assert.deepEqual(await getCurrentFuseWire(executable), configured, 'Repeated packaging must be idempotent.');
    assert.deepEqual(await getCurrentFuseWire(source), original, 'The development Electron must never be modified.');
  } finally {
    // Only this newly created, resolved temp directory is removed.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
