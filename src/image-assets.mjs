import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { imageDestinations, rewriteImageDestinations } from './images.mjs';
import { t } from './i18n.mjs';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BATCH_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 10;
const draftPattern = /^md-draft-image:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:png|jpg|gif|webp))$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalidImage = () => new Error(t('请选择有效的 PNG、JPEG、GIF 或 WebP 图片。'));

export function imageExtension(bytes) {
  if (!(bytes instanceof Uint8Array)) throw invalidImage();
  const value = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (value.length >= 24 && value.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && value.toString('ascii', 12, 16) === 'IHDR') return '.png';
  if (value.length >= 4 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return '.jpg';
  if (value.length >= 13 && ['GIF87a', 'GIF89a'].includes(value.toString('ascii', 0, 6))) return '.gif';
  if (value.length >= 16 && value.toString('ascii', 0, 4) === 'RIFF' && value.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(value.toString('ascii', 12, 16))) return '.webp';
  throw invalidImage();
}

export function validateImageItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_IMAGE_COUNT) throw new Error(t('每次最多插入 10 张图片。'));
  let total = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || !(item.bytes instanceof Uint8Array)) throw invalidImage();
    if (item.bytes.byteLength === 0 || item.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(t('每张图片不能超过 20 MB。'));
    total += item.bytes.byteLength;
    if (total > MAX_IMAGE_BATCH_BYTES) throw new Error(t('每次插入的图片合计不能超过 50 MB。'));
    imageExtension(item.bytes);
  }
  return items.map(item => {
    const name = typeof item.name === 'string' ? item.name.replaceAll('\\', '/').split('/').pop() : '';
    const alt = (name?.replace(/\.[^.]*$/, '') || t('图片')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 255);
    const bytes = Buffer.from(item.bytes);
    return { bytes, ext: imageExtension(bytes), alt };
  });
}

export function createImageAssetStore(userData, { fsApi = fs, randomUUIDImpl = randomUUID } = {}) {
  const cacheRoot = path.resolve(userData, 'image-drafts');
  function draftDirectory(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new Error(t('图片所属的文档无效。'));
    // Recovery ids are stable but are not assumed to be safe path components.
    return path.join(cacheRoot, createHash('sha256').update(id).digest('hex'));
  }
  async function checkDirectory(directory, create = false) {
    if (create) await fsApi.mkdir(directory, { recursive: true });
    const info = await fsApi.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(t('图片保存位置无效。'));
  }
  async function cacheDirectory(id, create = false) {
    const directory = draftDirectory(id);
    await checkDirectory(cacheRoot, create); await checkDirectory(directory, create);
    return directory;
  }
  function destinationFor(target) {
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error(t('图片所属的文档无效。'));
    const name = path.basename(target, path.extname(target)) + '.assets';
    return { directory: path.join(path.dirname(target), name), prefix: encodeURIComponent(name).replace(/[()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase()) + '/' };
  }
  async function writeUnique(directory, bytes, ext, created) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = randomUUIDImpl();
      if (!uuidPattern.test(id)) throw new Error(t('无法生成图片文件名，请重试。'));
      const filename = id + ext, target = path.join(directory, filename);
      let handle;
      try { handle = await fsApi.open(target, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      created.push(target);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      return filename;
    }
    throw new Error(t('无法生成图片文件名，请重试。'));
  }
  async function rollback(created) { await Promise.allSettled(created.map(filename => fsApi.unlink(filename))); }
  async function resolveDraft(id, source) {
    const match = typeof source === 'string' && draftPattern.exec(source);
    if (!match) throw new Error(t('暂存图片引用无效。'));
    const directory = await cacheDirectory(id);
    const filename = path.join(directory, match[1]);
    const info = await fsApi.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > MAX_IMAGE_BYTES) throw new Error(t('暂存图片无法读取，请重新插入图片。'));
    return filename;
  }
  return {
    async importImages(record, items) {
      if (!record || record.type === 'mindmap') throw new Error(t('请在 Markdown 文档中插入图片。'));
      draftDirectory(record.id);
      const prepared = validateImageItems(items);
      const saved = record.path ? destinationFor(record.path) : null;
      const directory = saved?.directory ?? await cacheDirectory(record.id, true);
      if (saved) await checkDirectory(directory, true);
      const created = [], images = [];
      try {
        for (const item of prepared) {
          const filename = await writeUnique(directory, item.bytes, item.ext, created);
          images.push({ src: saved ? saved.prefix + filename : 'md-draft-image:' + filename, alt: item.alt });
        }
        return images;
      } catch (error) { await rollback(created); throw error; }
    },
    resolveDraft,
    async materialize(record, content, target) {
      const sources = imageDestinations(content).filter(source => typeof source === 'string' && /^md-draft-image:/i.test(source));
      if (!sources.length) return { content, imageReplacements: [] };
      const prepared = [];
      // Check every reference before publishing destination files. Never move
      // originals: open undo history and either recovery snapshot may need them.
      for (const from of sources) prepared.push({ from, filename: await resolveDraft(record.id, from) });
      const destination = destinationFor(target);
      await checkDirectory(destination.directory, true);
      const created = [], replacements = new Map();
      try {
        for (const item of prepared) {
          const bytes = await fsApi.readFile(item.filename);
          if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(t('每张图片不能超过 20 MB。'));
          const ext = imageExtension(bytes);
          if (path.extname(item.filename) !== ext) throw new Error(t('暂存图片无法读取，请重新插入图片。'));
          const filename = await writeUnique(destination.directory, bytes, ext, created);
          replacements.set(item.from, destination.prefix + filename);
        }
        const rewritten = rewriteImageDestinations(content, replacements);
        if (imageDestinations(rewritten).some(source => replacements.has(source))) throw new Error(t('暂存图片无法读取，请重新插入图片。'));
        return { content: rewritten, imageReplacements: [...replacements].map(([from, to]) => ({ from, to })), rollback: () => rollback(created) };
      } catch (error) { await rollback(created); throw error; }
    },
    async discard(id) {
      const directory = draftDirectory(id);
      if (path.dirname(directory) !== cacheRoot) throw new Error(t('图片保存位置无效。'));
      try { await cacheDirectory(id); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      await fsApi.rm(directory, { recursive: true, force: true });
    },
  };
}
