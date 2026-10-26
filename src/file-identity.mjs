import path from 'node:path';
import fs from 'node:fs/promises';

// realpath resolves symbolic links but does not promise the on-disk spelling on
// case-insensitive volumes. Read each component without lower-casing the key:
// this also preserves two distinct files on a case-sensitive Mac volume.
async function diskSpelling(value, pathApi, fsApi) {
  let parent = pathApi.parse(value).root;
  for (const component of value.slice(parent.length).split(pathApi.sep).filter(Boolean)) {
    const entries = await fsApi.readdir(parent);
    let name = component;
    if (!entries.includes(component)) {
      const folded = component.normalize('NFD').toLowerCase();
      const candidates = entries.filter(entry => entry.normalize('NFD').toLowerCase() === folded);
      if (candidates.length === 1) name = candidates[0];
    }
    parent = pathApi.join(parent, name);
  }
  return parent;
}

export async function documentFileKey(target, { platform = process.platform, pathApi = path, fsApi = fs } = {}) {
  const canonical = async value => {
    const real = await fsApi.realpath(value);
    if (platform !== 'darwin') return real;
    try { return await diskSpelling(real, pathApi, fsApi); }
    catch (error) {
      // A readable file may have an execute-only parent. Preserve its resolved
      // spelling rather than guessing and potentially merging distinct files.
      if (['EACCES', 'EPERM'].includes(error.code)) return real;
      throw error;
    }
  };
  const key = value => platform === 'win32' ? value.toLowerCase() : value;
  try { return key(await canonical(target)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { return key(pathApi.join(await canonical(pathApi.dirname(target)), pathApi.basename(target))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return key(pathApi.resolve(target));
  }
}

// Moving a symlink renames its directory entry, not the file it points to.
// Resolve parent aliases without dereferencing the final path component.
async function documentEntryKey(target, { platform, pathApi, fsApi }) {
  const entry = pathApi.join(await fsApi.realpath(pathApi.dirname(target)), pathApi.basename(target));
  if (platform === 'win32') return entry.toLowerCase();
  if (platform !== 'darwin') return entry;
  try { return await diskSpelling(entry, pathApi, fsApi); }
  catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) return entry;
    throw error;
  }
}

// Match references before moving the file, while aliases still resolve. A
// regular file uses the same canonical path identity as open tabs, keeping
// separate hardlinks distinct. A source symlink uses its own entry identity.
export async function findDocumentAliases(target, candidates, { platform = process.platform, pathApi = path, fsApi = fs } = {}) {
  const invalid = () => Object.assign(new TypeError('Invalid document reference paths'), { code: 'INVALID_DOCUMENT_REFERENCES' });
  if (!Array.isArray(candidates) || candidates.length > 100000) throw invalid();
  let bytes = 0;
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.includes('\0') || !pathApi.isAbsolute(candidate)
      || (bytes += Buffer.byteLength(candidate, 'utf8')) > 8 * 1024 * 1024) throw invalid();
  }
  if (!candidates.length) return [];
  const options = { platform, pathApi, fsApi };
  const sourceIsSymlink = (await fsApi.lstat(target)).isSymbolicLink();
  const keyFor = sourceIsSymlink ? documentEntryKey : documentFileKey;
  const sourceKey = await keyFor(target, options);
  const unique = [...new Set(candidates)], aliases = [];
  // Bound concurrent filesystem work even when many maps have undo history.
  for (let index = 0; index < unique.length; index += 16) {
    const matches = await Promise.all(unique.slice(index, index + 16).map(async candidate => {
      try {
        if (sourceIsSymlink) await fsApi.lstat(candidate);
        else await fsApi.stat(candidate);
        return await keyFor(candidate, options) === sourceKey ? candidate : null;
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
        throw error;
      }
    }));
    aliases.push(...matches.filter(value => value !== null));
  }
  return aliases;
}
