import path from 'node:path';

export function isWindowsAbsolutePath(value) {
  return typeof value === 'string' && value.length <= 32767
    && !/[\x00-\x1f\x7f"<>|?*]/.test(value)
    && /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value)
    && !value.slice(2).includes(':');
}

// NSIS runs Electron from a disposable directory. Only the outer launcher is
// suitable for a shortcut, a file association, or a path shown to the user.
export function applicationLaunchContext({
  isPackaged, executablePath = process.execPath, env = process.env,
  cwd = process.cwd(), platform = process.platform,
} = {}) {
  // Generic electron-builder variables may be inherited from another portable
  // app. Our wrapper identifies the exact extracted runtime it is launching.
  const portable = platform === 'win32' && isPackaged === true
    && isWindowsAbsolutePath(env.MD_PORTABLE_RUNTIME)
    && path.win32.normalize(env.MD_PORTABLE_RUNTIME).toLowerCase() === path.win32.normalize(executablePath).toLowerCase();
  const launcher = env.PORTABLE_EXECUTABLE_FILE;
  const validLauncher = isWindowsAbsolutePath(launcher) && path.win32.extname(launcher).toLowerCase() === '.exe';
  return {
    // Invalid wrapper metadata must not silently register the temporary exe.
    executablePath: portable ? (validLauncher ? launcher : null) : executablePath,
    runtimeExecutablePath: executablePath,
    cwd: portable && isWindowsAbsolutePath(env.MD_PORTABLE_CWD) ? env.MD_PORTABLE_CWD : cwd,
    portable,
  };
}

export function secondInstanceWorkingDirectory(additionalData, fallback, platform = process.platform) {
  const cwd = additionalData?.cwd;
  const valid = platform === 'win32' ? isWindowsAbsolutePath(cwd)
    : typeof cwd === 'string' && path.posix.isAbsolute(cwd) && !/[\x00-\x1f\x7f]/.test(cwd);
  return valid ? cwd : fallback;
}
