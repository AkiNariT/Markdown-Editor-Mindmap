import { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options } from '@electron/fuses';

// An inherited ELECTRON_RUN_AS_NODE must not turn a GUI release into Node.
// Node options are likewise irrelevant to end users and can prevent startup.
// Keep the CLI inspector for our packaged Playwright regression tests. The
// unpacked resources/app layout also requires OnlyLoadAppFromAsar to stay off.
export async function configurePackagedFuses(executable, { resetAdHocDarwinSignature = false } = {}) {
  await flipFuses(executable, {
    version: FuseVersion.V1,
    // Modifying Electron Framework invalidates its signature. macOS releases
    // restore an ad-hoc signature only after all app content has been written.
    resetAdHocDarwinSignature,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
  });
  const actual = await getCurrentFuseWire(executable);
  for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.OnlyLoadAppFromAsar]) {
    if (actual[option] !== '0'.charCodeAt(0)) throw new Error(`Packaging failed to disable Electron fuse ${FuseV1Options[option]}.`);
  }
}
