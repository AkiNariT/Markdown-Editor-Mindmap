import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { readDocument, MAX_DOCUMENT_BYTES } from './files.mjs';
import { t } from './i18n.mjs';
import { splitFrontmatter } from './frontmatter.mjs';
import { imageDestinations, rewriteImageDestinations } from './images.mjs';
import { imageExtension, MAX_IMAGE_BYTES } from './image-assets.mjs';
import { parseMindmap } from './mindmap.mjs';
import { relocateHeadingAnchors } from './mindmap-outline.mjs';

const error = code => Object.assign(new Error(code), { code });
const networkPath = value => /^[/\\]{2}/.test(value);
const resourceKey = filename => process.platform === 'win32' ? filename.toLowerCase() : filename;
const imageFile = value => /\.(?:png|jpe?g|gif|webp)$/i.test(value);
const documentFile = value => /\.(?:md|markdown)$/i.test(value);
const stamp = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join('/');

const tooLarge = name => Object.assign(new Error(t('“{name}”超过 8 MB，无法加入可编辑分享包。', { name })), { code: 'SHARE_DOCUMENT_TOO_LARGE' });
function checkDocumentSize(name, content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw tooLarge(name);
}

function portableName(input, fallback) {
  let name = path.win32.basename(input || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '');
  if (!name || name === '.') name = fallback;
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name)) name = '_' + name;
  // Leave space for a numeric disambiguator on filesystems with 255-byte names.
  if (Buffer.byteLength(name) <= 235) return name;
  const suffix = path.posix.extname(name), extension = Buffer.byteLength(suffix) < 24 ? suffix : '';
  let trimmed = '', size = Buffer.byteLength(extension);
  for (const character of name.slice(0, name.length - extension.length)) {
    size += Buffer.byteLength(character);
    if (size > 235) break;
    trimmed += character;
  }
  return trimmed + extension;
}

function markdownPath(from, to) {
  return path.posix.relative(path.posix.dirname(from), to).split('/').map(part =>
    encodeURIComponent(part).replace(/[()]/g, char => char === '(' ? '%28' : '%29')).join('/');
}

function localPath(value, owner) {
  if (!value || value.includes('\0') || networkPath(value) || /^(?![a-z]:[/\\])[a-z][a-z\d+.-]*:/i.test(value)) return null;
  // Drive-relative paths and alternate data streams cannot be relocated.
  if (value.replace(/^[a-z]:[/\\]/i, '').includes(':')) return null;
  if (path.isAbsolute(value)) return path.normalize(value);
  if (!owner || !path.isAbsolute(owner) || networkPath(owner)) return null;
  return path.resolve(path.dirname(owner), value);
}

async function realLocalPath(filename) {
  if (!filename || networkPath(filename)) return null;
  try {
    const real = await fs.realpath(filename);
    return networkPath(real) ? null : real;
  } catch (cause) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(cause.code)) return null;
    throw cause;
  }
}

async function inspectImage(filename) {
  if (!filename || !imageFile(filename)) return null;
  if (!(await fs.stat(filename)).isFile()) return null;
  const handle = await fs.open(filename, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    const header = Buffer.alloc(24), { bytesRead } = await handle.read(header, 0, header.length, 0);
    try { imageExtension(header.subarray(0, bytesRead)); } catch { return null; }
    return { filename, size: info.size, stamp: stamp(info) };
  } finally { await handle.close(); }
}

// The plan stays in the main process. Only names and warnings need to be shown
// to the user. Markdown is snapshotted now, images are read one at a time later.
export async function prepareShareBundle(root, { getDocument, getNodeDraft, resolveDraftImage } = {}) {
  if (!['markdown', 'mindmap'].includes(root?.type) || typeof root.content !== 'string') throw error('SHARE_INVALID_DOCUMENT');
  const isMap = root.type === 'mindmap', fallback = isMap ? 'Mindmap.mdmap' : 'Document.md';
  let rootName = portableName(root.path || root.suggestedName, fallback);
  if (!(isMap ? /\.mdmap$/i.test(rootName) : documentFile(rootName))) rootName += isMap ? '.mdmap' : '.md';
  checkDocumentSize(rootName, root.content);
  const entries = [], warnings = [], notes = new Map(), assets = new Map(), usedNames = new Set();
  function addDocument(name, content) {
    checkDocumentSize(name, content);
    entries.push({ name, content });
  }
  function allocate(folder, original, fallback) {
    const base = portableName(original, fallback);
    let name = folder + '/' + base, number = 1;
    // Retain filename-based semantics such as SKILL.md for namesakes.
    while (usedNames.has(name.toLowerCase())) name = folder + '/' + (++number) + '/' + base;
    usedNames.add(name.toLowerCase()); return name;
  }
  async function copyMarkdown(doc, name) {
    checkDocumentSize(name, doc.content);
    if (!doc.content.includes('![')) { addDocument(name, doc.content); return doc.content; }
    const header = splitFrontmatter(doc.content), body = header?.body ?? doc.content, replacements = new Map();
    const references = imageDestinations(body);
    for (const ref of references) {
      if (/^data:/i.test(ref)) continue;
      let decoded, source, remote = false;
      if (/^md-draft-image:/i.test(ref)) {
        if (doc.id && resolveDraftImage) {
          try { source = await resolveDraftImage(doc.id, ref); } catch { /* the draft image is unavailable */ }
        }
      } else {
        try {
          if (/^file:/i.test(ref)) {
            const url = new URL(ref);
            if (url.hostname && url.hostname !== 'localhost') remote = true;
            else decoded = fileURLToPath(url);
          } else decoded = decodeURIComponent(ref);
        } catch { /* invalid URL or path encoding */ }
        if (decoded) {
          remote = networkPath(decoded) || /^(?![a-z]:[/\\])[a-z][a-z\d+.-]*:/i.test(decoded);
          if (!remote) source = localPath(decoded, doc.path);
        }
      }
      if (remote || (source && networkPath(source))) {
        warnings.push({ kind: 'remote', document: name, reference: ref }); continue;
      }
      const real = await realLocalPath(source);
      const key = (real || source) ? resourceKey(real || source) : name + '\0' + ref;
      let asset = assets.get(key);
      if (!asset) {
        const original = real || source || decoded || ref;
        const archive = allocate('assets', original, 'image.png');
        let info;
        try { info = await inspectImage(real); }
        catch (cause) { if (!['ENOENT', 'ENOTDIR', 'EPERM', 'EACCES'].includes(cause.code)) throw cause; }
        asset = { archive, available: Boolean(info) }; assets.set(key, asset);
        if (info) entries.push({ name: archive, image: info });
      }
      if (!asset.available) warnings.push({ kind: 'missing', document: name, reference: ref });
      replacements.set(ref, markdownPath(name, asset.archive));
    }
    const rewritten = rewriteImageDestinations(body, replacements);
    if (replacements.size) {
      const expected = new Set(references.map(ref => replacements.get(ref) ?? ref));
      const actual = imageDestinations(rewritten);
      if (actual.length !== expected.size || actual.some(ref => !expected.has(ref))) throw error('SHARE_IMAGE_REWRITE_FAILED');
    }
    const content = (header?.prefix || '') + rewritten;
    addDocument(name, content);
    return content;
  }

  if (isMap) {
    parseMindmap(root.content);
    // Keep extra metadata supplied by a compatible writer when changing file links.
    const data = JSON.parse(root.content.replace(/^\ufeff/, ''));
    let changed = false;
    for (const node of data.nodes) {
      const ref = node.file;
      const draft = ref === null ? await getNodeDraft?.(node.id) : null;
      if (ref === null && !draft) continue;
      const source = ref ? localPath(ref, root.path) : null, real = await realLocalPath(source);
      const key = draft ? 'draft\0' + (draft.id || node.id) : resourceKey(real || source || ref);
      let note = notes.get(key);
      if (!note) {
        let candidate = draft?.suggestedName || real || source || ref;
        if (!documentFile(candidate)) candidate = (candidate || 'Document') + '.md';
        note = { name: allocate('documents', candidate, 'Document.md'), ref, source, real, draft, headingLinks: [] };
        notes.set(key, note);
      }
      if (node.headingAnchor) note.headingLinks.push(node);
      if (node.file !== note.name) { node.file = note.name; changed = true; }
    }
    for (const { name, ref, source, real, draft, headingLinks } of notes.values()) {
      let current = draft || (source ? await getDocument?.(source) : null);
      if (!current && real && documentFile(real)) {
        try { current = await readDocument(real); }
        catch (cause) {
          if (cause.code === 'DOCUMENT_TOO_LARGE') throw tooLarge(name);
          // Other unreadable node documents are reported in the preview.
        }
      }
      if (current) {
        if (typeof current.content !== 'string') throw error('SHARE_INVALID_DOCUMENT');
        const rewritten = await copyMarkdown({ ...current, path: source }, name);
        if (relocateHeadingAnchors(headingLinks, current.content, rewritten)) changed = true;
      } else warnings.push({ kind: ref && networkPath(ref) ? 'remote' : 'missing', document: rootName, reference: ref });
    }
    let content = root.content;
    if (changed) {
      const newline = root.content.includes('\r\n') ? '\r\n' : '\n';
      content = (root.content.startsWith('\ufeff') ? '\ufeff' : '') + JSON.stringify(data, null, 2).replaceAll('\n', newline);
      if (root.content.endsWith('\n')) content += newline;
    }
    addDocument(rootName, content);
  } else await copyMarkdown(root, rootName);
  return { rootName, warnings, entries };
}

async function* verifiedImage(image) {
  const handle = await fs.open(image.filename, 'r');
  try {
    if (stamp(await handle.stat()) !== image.stamp) throw error('SHARE_SOURCE_CHANGED');
    for await (const chunk of handle.createReadStream({ autoClose: false })) yield chunk;
    if (stamp(await handle.stat()) !== image.stamp) throw error('SHARE_SOURCE_CHANGED');
  } finally { await handle.close(); }
}

async function targetStamp(filename) {
  try {
    const info = await fs.lstat(filename);
    if (!info.isFile()) throw error('SHARE_TARGET_CHANGED');
    return stamp(info);
  } catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
}

export async function writeShareBundle(plan, target, { overwrite = false } = {}) {
  if (!path.isAbsolute(target) || !/\.zip$/i.test(target)) throw error('SHARE_INVALID_TARGET');
  const previous = await targetStamp(target);
  if (previous !== null && !overwrite) throw error('EEXIST');
  const temp = path.join(path.dirname(target), '.md-share-' + randomUUID() + '.tmp');
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    const zip = new yazl.ZipFile(), output = createWriteStream(temp, { fd: handle.fd, autoClose: false });
    let activeInput;
    zip.on('error', cause => zip.outputStream.destroy(cause));
    const finished = pipeline(zip.outputStream, output);
    try {
      for (const entry of plan.entries) {
        zip.addReadStreamLazy(entry.name, { compress: !entry.image }, callback => {
          const input = entry.image ? Readable.from(verifiedImage(entry.image)) : Readable.from([Buffer.from(entry.content, 'utf8')]);
          activeInput = input;
          input.on('error', cause => zip.outputStream.destroy(cause));
          callback(null, input);
        });
      }
      zip.end(); await finished;
    } catch (cause) {
      activeInput?.destroy(); zip.outputStream.destroy(cause); await finished.catch(() => {}); throw cause;
    }
    await handle.sync(); await handle.close();
    if (previous !== null) {
      if (await targetStamp(target) !== previous) throw error('SHARE_TARGET_CHANGED');
      await fs.rename(temp, target);
    } else {
      try { await fs.link(temp, target); }
      catch (cause) {
        if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(cause.code)) throw cause;
        await fs.copyFile(temp, target, constants.COPYFILE_EXCL);
      }
    }
    return { path: target, rootName: plan.rootName, entryCount: plan.entries.length };
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(temp, { force: true });
  }
}
