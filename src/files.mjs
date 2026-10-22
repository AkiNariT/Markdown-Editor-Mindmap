import { t } from './i18n.mjs';
import { readFile, open, rename, unlink, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const MAX_BYTES = 8 * 1024 * 1024;
const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');

export function normalizeDocumentName(value, extension = 'md') {
  if (!['md', 'mdmap'].includes(extension)) throw new Error(t('文档扩展名无效。'));
  const allowed = extension === 'mdmap' ? /\.mdmap$/i : /\.(md|markdown)$/i;
  if (typeof value !== 'string' || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value)) throw new Error(t('文件名不能包含换行或以下字符：\\ / : * ? " < > |'));
  const name = value.trim();
  if (!name || name.endsWith('.') || (name.startsWith('.') && allowed.test(name) && name.indexOf('.', 1) < 0)) throw new Error(t('请输入有效文件名，不能仅有扩展名或以句号结尾。'));
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name)) throw new Error(t('这个名称是 Windows 保留名称，请换一个文件名。'));
  const result = allowed.test(name) ? name : name + '.' + extension;
  if (result.length > 255) throw new Error(t('文件名过长，请缩短到 255 个字符以内（含扩展名）。'));
  return result;
}

// MoveFileExW without REPLACE_EXISTING performs a single non-overwriting rename,
// including case-only names. Paths are JSON stdin data, never executable script.
const moveScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MdFileMove { [DllImport("kernel32.dll", EntryPoint="MoveFileExW", CharSet=CharSet.Unicode, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool Move(string source, string target, uint flags); }'
if (-not [MdFileMove]::Move($request.source, $request.target, 0)) {
  [Console]::Error.Write([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 1
}
`;
function windowsPath(value) { return value.startsWith('\\\\?\\') ? value : value.startsWith('\\\\') ? '\\\\?\\UNC\\' + value.slice(2) : '\\\\?\\' + value; }
export async function renameDocument(source, name, expectedFingerprint, extension = 'md', { platform = process.platform, execFileImpl = execFile, helperPath } = {}) {
  const target = join(dirname(resolve(source)), normalizeDocumentName(name, extension));
  const original = await readDocument(source);
  if (original.fingerprint !== expectedFingerprint) throw new Error(t('文件已被外部修改，请重新打开或另存为后再重命名。'));
  if (resolve(source) === target) return target;
  try {
    const destination = await stat(target), current = await stat(source);
    if (resolve(source).toLowerCase() !== target.toLowerCase() || destination.dev !== current.dev || destination.ino !== current.ino) throw new Error(t('同目录中已存在这个名称，请换一个文件名。'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (platform === 'darwin') {
    // The helper uses renamex_np(RENAME_EXCL); never fall back to Node rename,
    // which could overwrite a destination created after the check above.
    const executable = helperPath || (process.resourcesPath && !process.defaultApp
      ? join(process.resourcesPath, 'md-rename')
      : fileURLToPath(new URL('../build/macos/md-rename', import.meta.url)));
    await new Promise((resolveMove, reject) => {
      execFileImpl(executable, [resolve(source), target, expectedFingerprint], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 }, (error, stdout, stderr) => {
        if (!error) return resolveMove();
        const code = stderr?.trim();
        reject(new Error(code === 'EEXIST' ? t('同目录中已存在这个名称，请换一个文件名。')
          : code === 'ENOENT' ? t('原文件已移动或删除，请重新打开。')
          : code === 'ECHANGED' ? t('文件已被外部修改，请重新打开或另存为后再重命名。')
          : ['EACCES', 'EPERM', 'EBUSY'].includes(code) ? t('文件正被占用或没有改名权限，请关闭占用程序后重试。')
          : code === 'ENOTSUP' ? t('这个磁盘不支持安全重命名，请另存为后再处理原文件。')
          : t('未能完成重命名，请检查文件位置、权限及应用是否完整。')));
      });
    });
    return target;
  }
  if (platform !== 'win32') throw new Error(t('当前系统不支持安全重命名。'));
  await new Promise((resolveMove, reject) => {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(moveScript, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 }, (error, stdout, stderr) => {
      if (!error) return resolveMove();
      const code = Number(stderr.trim());
      reject(new Error([80, 183].includes(code) ? t('同目录中已存在这个名称，请换一个文件名。') : [2, 3].includes(code) ? t('原文件已移动或删除，请重新打开。') : [5, 32].includes(code) ? t('文件正被占用或没有改名权限，请关闭占用程序后重试。') : t('未能完成重命名，请检查文件位置、权限及系统 PowerShell 是否可用。')));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ source: windowsPath(resolve(source)), target: windowsPath(target) }));
  });
  return target;
}

export async function readDocument(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(t('请选择 Markdown 文件。'));
  if (info.size > MAX_BYTES) throw new Error(t('首版支持最大 8 MB 的文档。'));
  const bytes = await readFile(path);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(t('文件不是有效 UTF-8 编码。请先转换为 UTF-8 后打开。')); }
  return { path, content, fingerprint: fingerprint(bytes) };
}

export async function writeDocument(path, content, expectedFingerprint) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error(t('文档超过 8 MB 或内容无效。'));
  const verify = async () => {
    let current = null;
    try { current = fingerprint(await readFile(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== expectedFingerprint) throw new Error(t('文件已被外部修改或删除。请另存为，避免覆盖其他修改。'));
  };
  await verify();
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await verify();
    await rename(temporary, path);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error(t('临时文件清理失败'), error.code); });
  }
  return { path, content, fingerprint: fingerprint(Buffer.from(content, 'utf8')) };
}
