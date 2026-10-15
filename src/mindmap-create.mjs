import { open, link, lstat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeDocumentName } from './files.mjs';
import { t } from './i18n.mjs';

function titleText(value) {
  if (typeof value !== 'string') throw new Error(t('节点文字无效。'));
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/gu, ' ').trim();
}

export function suggestNodeFileName(text) {
  let name = titleText(text).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/gu, ' ').trim().replace(/\.(?:md|markdown)$/i, '').replace(/[. ]+$/g, '');
  let shortened = '';
  for (const character of name.toWellFormed()) {
    if (shortened.length + character.length > 240) break;
    shortened += character;
  }
  name = shortened.replace(/[. ]+$/g, '') || t('未命名');
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name)) name = '_' + name;
  return normalizeDocumentName(name);
}

export function nodeMarkdown(text) {
  const title = titleText(text) || t('未命名');
  // Escape ASCII Markdown punctuation, including HTML/entity syntax. Node text
  // must stay literal, and its line breaks cannot create additional blocks.
  return '# ' + title.replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, '\\$&') + '\n\n';
}

async function unsupportedLink(error, source, destination) {
  if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) return true;
  // Windows libuv maps ERROR_INVALID_FUNCTION to EISDIR. Disambiguate that
  // unsupported-link result from an actual directory collision. EPERM is a
  // permissions error and must not be treated as unsupported storage.
  if (process.platform !== 'win32' || error.code !== 'EISDIR' || !(await lstat(source)).isFile()) return false;
  try { await lstat(destination); return false; }
  catch (check) { if (check.code === 'ENOENT') return true; throw check; }
}

async function writeExclusive(destination, content) {
  let handle, identity;
  try {
    handle = await open(destination, 'wx', 0o600);
    identity = await handle.stat({ bigint: true });
    await handle.writeFile(content, 'utf8'); await handle.sync();
    await handle.close(); handle = null;
  } catch (error) {
    if (handle && identity?.ino !== undefined && identity.ino !== 0n) {
      try {
        const current = await lstat(destination, { bigint: true });
        // Keep the original handle open while checking. If another writer has
        // moved/replaced this path, its new file must not be removed on failure.
        if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino && current.birthtimeNs === identity.birthtimeNs) await unlink(destination);
      } catch (cleanup) { if (cleanup.code !== 'ENOENT') console.error(t('临时文件清理失败'), cleanup.code); }
    }
    throw error;
  } finally { if (handle) await handle.close().catch(() => {}); }
}

export async function createNodeMarkdown(target, text) {
  if (typeof target !== 'string' || !isAbsolute(target) || /[\x00-\x1f\x7f-\x9f]/.test(target) || !/\.(md|markdown)$/i.test(target)) throw new Error(t('请选择有效的 Markdown 文件位置。'));
  if (normalizeDocumentName(basename(target)) !== basename(target)) throw new Error(t('请选择有效的 Markdown 文件位置。'));
  const destination = resolve(target), content = nodeMarkdown(text);
  const temporary = join(dirname(destination), '.md-node-' + randomUUID() + '.tmp');
  let handle, ownsTemporary = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    await handle.writeFile(content, 'utf8'); await handle.sync();
    await handle.close(); handle = null;
    // The preferred path publishes complete text atomically. Filesystems that
    // cannot hard-link use exclusive creation plus a synced write; that fallback
    // is not atomic, but never opens an existing destination for modification.
    try { await link(temporary, destination); }
    catch (error) {
      try {
        if (!await unsupportedLink(error, temporary, destination)) throw error;
        await writeExclusive(destination, content);
      } catch (failure) {
        if (failure.code === 'EEXIST') throw Object.assign(new Error(t('这个位置已存在文件，请选择新名称。')), { code: 'EEXIST', cause: failure });
        throw failure;
      }
    }
    return { path: destination };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (ownsTemporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error(t('临时文件清理失败'), error.code); });
  }
}
