import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { release as osRelease } from 'node:os';
import { win32 as path } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const settingsUri = 'ms-settings:defaultapps';
const applicationSettingsUri = `${settingsUri}?registeredAppUser=MD`;

function diagnostic(error) {
  const metadata = [error?.code, error?.signal].filter(value => typeof value === 'string' || typeof value === 'number').join(' / ');
  const reason = typeof error?.stderr === 'string' && error.stderr.trim() ? error.stderr : error?.message;
  // Keep the original cause for troubleshooting, without stacks, unbounded
  // subprocess output or terminal controls. The renderer displays plain text.
  return [metadata, typeof reason === 'string' ? reason : 'Unknown error'].filter(Boolean).join('\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 4000);
}

function registrationFailure(error, checkingScript) {
  let code = 'FAILED';
  if (error?.code === 'ENOENT') code = checkingScript ? 'HELPER_MISSING' : 'POWERSHELL_MISSING';
  else if (error?.code === 'EACCES' || error?.code === 'EPERM') code = 'ACCESS_DENIED';
  else if (error?.code === 'ETIMEDOUT' || (error?.killed === true && error?.signal === 'SIGTERM' && error?.code == null)) code = 'TIMEOUT';
  else if (typeof error?.stderr === 'string') {
    // These markers come from our own script or a typed PowerShell exception;
    // generic exit code 1 alone does not prove a conflict or permissions issue.
    if (/(?:Registration|Shortcut) conflict:/.test(error.stderr)) code = 'CONFLICT';
    else if (/\bSystem\.UnauthorizedAccessException\b/.test(error.stderr)) code = 'ACCESS_DENIED';
  }
  return { status: 'failed', code, detail: diagnostic(error) };
}

async function launchSettings(openExternal, uri) {
  try {
    await openExternal(uri);
    return { status: 'opened' };
  } catch (error) {
    if (uri !== settingsUri) return launchSettings(openExternal, settingsUri);
    return { status: 'failed', code: 'SETTINGS_FAILED', detail: diagnostic(error) };
  }
}

function result(registration, settings) {
  // Launching Settings does not confirm that any default application changed.
  return { status: settings.status, requiresUserChoice: true, registration, settings };
}

// A fixed, independent escape hatch: no registration, scripts or renderer URI.
export async function openWindowsDefaultSettings({ openExternal, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('WINDOWS_DEFAULT_UNSUPPORTED');
  return result({ status: 'skipped' }, await launchSettings(openExternal, settingsUri));
}

// Only the main process supplies these options; the renderer supplies no paths,
// executable names, script arguments, registry keys, or URI values.
export async function openWindowsDefaultApps({
  isPackaged, openExternal, executablePath = process.execPath,
  platform = process.platform, release = osRelease(),
  systemRoot = process.env.SystemRoot, execFileImpl = execute, accessImpl = access,
} = {}) {
  if (platform !== 'win32') throw new Error('WINDOWS_DEFAULT_UNSUPPORTED');
  if (isPackaged !== true) throw new Error('WINDOWS_DEFAULT_DEVELOPMENT');
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)
    || path.basename(executablePath).toLowerCase() !== 'md.exe' || /["\r\n]/.test(executablePath)
    || typeof systemRoot !== 'string' || !path.isAbsolute(systemRoot)) {
    throw new Error('WINDOWS_DEFAULT_REGISTRATION');
  }
  const scriptPath = path.join(path.dirname(executablePath), 'windows-integration.ps1');
  let registration, checkingScript = true;
  try {
    await accessImpl(scriptPath);
    checkingScript = false;
    await execFileImpl(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      scriptPath,
      '-Action', 'RegisterDefaultApps', '-ExecutablePath', executablePath,
    ], { windowsHide: true, shell: false, timeout: 30000, maxBuffer: 256 * 1024, encoding: 'utf8' });
    registration = { status: 'registered' };
  } catch (error) {
    registration = registrationFailure(error, checkingScript);
  }

  // App-specific links require Windows 11 23H2+, or cumulative updates on
  // 21H2/22H2. os.release() does not prove those updates, so use the general
  // page on earlier builds. Microsoft documents both URI forms here:
  // https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings
  const build = /^10\.0\.(\d+)(?:\.|$)/.exec(String(release))?.[1];
  const uri = registration.status === 'registered' && Number(build) >= 22631 ? applicationSettingsUri : settingsUri;
  return result(registration, await launchSettings(openExternal, uri));
}
