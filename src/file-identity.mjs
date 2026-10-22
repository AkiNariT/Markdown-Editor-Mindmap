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
