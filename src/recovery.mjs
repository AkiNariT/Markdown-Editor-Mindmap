import { t } from './i18n.mjs';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const invalidRecovery = message => Object.assign(new Error(message), { code: 'INVALID_RECOVERY' });
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 128 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const absolutePath = value => typeof value === 'string' && value.length <= 32768 && !value.includes('\0') && isAbsolute(value);
const bounded = (value, minimum, maximum, fallback = minimum) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function sanitizeViewState(value) {
  if (!plain(value)) return {};
  const result = {};
  for (const name of ['editing', 'outline', 'syncScroll']) if (typeof value[name] === 'boolean') result[name] = value[name];
  if (['render', 'source', 'compare', 'mindmap'].includes(value.view)) result.view = value.view;
  if (typeof value.zoom === 'number') result.zoom = bounded(value.zoom, 50, 200, 100);
  if (plain(value.viewScroll)) result.viewScroll = { render: bounded(value.viewScroll.render, 0, 1e8), compare: bounded(value.viewScroll.compare, 0, 1e8) };
  for (const name of ['sourceScroll', 'sourceLeft']) if (typeof value[name] === 'number') result[name] = bounded(value[name], 0, 1e8);
  if (plain(value.map)) {
    result.map = {};
    if (identifier(value.map.selected)) result.map.selected = value.map.selected;
    if (plain(value.map.position)) result.map.position = { top: bounded(value.map.position.top, 0, 1e8), left: bounded(value.map.position.left, 0, 1e8) };
    const padding = value.map.layoutPadding;
    if (plain(padding) && ['x', 'y'].every(axis => Number.isFinite(padding[axis]) && padding[axis] >= 0 && padding[axis] <= 1e6)) result.map.layoutPadding = { x: padding.x, y: padding.y };
  }
  return result;
}

function documentText(value) {
  if (typeof value !== 'string') throw invalidRecovery(t('恢复文档内容无效。'));
  if (Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES) throw invalidRecovery(t('恢复文档超过 8 MB，未写入备份。'));
  return value;
}

export function normalizeSession(value) {
  if (!plain(value) || value.version !== 1 || !Array.isArray(value.documents)) throw invalidRecovery(t('恢复记录格式无效。'));
  if (value.documents.length > 80) throw invalidRecovery(t('恢复记录最多支持 80 个标签，请关闭部分标签后重试。'));
  const ids = new Set(); let textBytes = 0;
  const documents = value.documents.map(entry => {
    if (!plain(entry) || !identifier(entry.id) || ids.has(entry.id)) throw invalidRecovery(t('恢复文档标识无效或重复。'));
    ids.add(entry.id);
    if (entry.path != null && !absolutePath(entry.path)) throw invalidRecovery(t('恢复文档路径无效。'));
    if (entry.fingerprint != null && (typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint))) throw invalidRecovery(t('恢复文档校验信息无效。'));
    if (entry.type !== undefined && !['markdown', 'mindmap'].includes(entry.type)) throw invalidRecovery(t('恢复文档类型无效。'));
    const result = { id: entry.id, type: entry.type || 'markdown', path: entry.path ?? null, content: documentText(entry.content), fingerprint: entry.fingerprint ?? null };
    textBytes += Buffer.byteLength(result.content, 'utf8');
    if (entry.draft !== undefined) { result.draft = documentText(entry.draft); textBytes += Buffer.byteLength(result.draft, 'utf8'); }
    if (textBytes > MAX_SESSION_BYTES) throw invalidRecovery(t('恢复备份总计超过 128 MB，请保存并关闭部分文档后重试。'));
    for (const name of ['dirty', 'copyOnly', 'editable', 'namedDraft', 'skillDocument', 'visualLossy']) {
      if (entry[name] !== undefined && typeof entry[name] !== 'boolean') throw invalidRecovery(t('恢复文档状态无效。'));
      if (name === 'skillDocument' && entry[name] === undefined) continue;
      result[name] = entry[name] === true;
    }
    if (typeof entry.suggestedName === 'string' && entry.suggestedName.length <= 255) result.suggestedName = entry.suggestedName;
    result.viewState = sanitizeViewState(entry.viewState);
    return result;
  });
  // Older sessions may contain retired library preferences; document recovery
  // is independent of them and future checkpoints leave those fields behind.
  return { version: 1, at: typeof value.at === 'string' ? value.at.slice(0, 64) : null, activeId: ids.has(value.activeId) ? value.activeId : documents[0]?.id ?? null, documents };
}

// Renderer data can update only the latest draft and display state. The main
// process retains ownership of the saved content, paths and fingerprints.
export function mergeCheckpoint(records, value, { validateMap } = {}) {
  if (!plain(value) || !Array.isArray(value.documents) || value.documents.length > 80) throw invalidRecovery(t('文档恢复状态无效。'));
  const seen = new Set();
  const updates = value.documents.map(state => {
    const record = records.get(state?.id);
    if (!record || seen.has(state.id)) throw invalidRecovery(t('文档标签已关闭或重复。'));
    seen.add(state.id);
    if (typeof state.dirty !== 'boolean') throw invalidRecovery(t('文档恢复状态无效。'));
    const draft = documentText(state.draft);
    if (record.type === 'mindmap' && validateMap) validateMap(draft);
    return { record, changes: { draft, dirty: state.dirty, viewState: sanitizeViewState(state.viewState), visualLossy: state.visualLossy === true } };
  });
  for (const { record, changes } of updates) {
    Object.assign(record, changes);
    if (changes.visualLossy && record.type !== 'mindmap') record.copyOnly = true;
    if (typeof changes.viewState.editing === 'boolean') record.editable = changes.viewState.editing;
  }
}

// Preparing a final close snapshot must not change live buffers: another tab's
// Cancel or a failed disk write still leaves the open editor intact.
export function sessionAfterDiscard(session, discarded) {
  const documents = session.documents.filter(entry => !discarded.has(entry.id) || entry.path).map(entry => {
    if (!discarded.has(entry.id)) return entry;
    const { draft, ...saved } = entry;
    return { ...saved, dirty: false, visualLossy: false };
  });
  return { ...session, documents, activeId: documents.some(entry => entry.id === session.activeId) ? session.activeId : documents[0]?.id ?? null };
}

export function createRecoveryStore(directory) {
  const primary = join(directory, 'session.json'), backup = join(directory, 'session.backup.json');
  let queued = Promise.resolve();
  async function readSnapshot(target) {
    if ((await stat(target)).size > MAX_SESSION_BYTES) throw invalidRecovery(t('恢复备份超过 128 MB。'));
    const text = await readFile(target, 'utf8');
    return { text, session: normalizeSession(JSON.parse(text)) };
  }
  async function atomicWrite(target, content) {
    const temporary = target + '.' + randomUUID() + '.tmp'; let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, target);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error(t('恢复临时文件清理失败'), error.code); });
    }
  }
  async function syncDirectory() {
    // Windows does not support opening a directory for fsync. The file itself
    // is always synced before the atomic rename on every supported platform.
    if (process.platform === 'win32') return;
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return {
    async load() {
      await queued;
      let primaryError;
      try { return { session: (await readSnapshot(primary)).session, notice: null, source: 'primary' }; }
      catch (error) { primaryError = error; }
      try { return { session: (await readSnapshot(backup)).session, notice: t('上次恢复记录不可用，已从上一份备份恢复。'), source: 'backup' }; }
      catch (error) {
        if (primaryError.code === 'ENOENT' && error.code === 'ENOENT') return { session: null, notice: null, source: null };
        return { session: null, notice: t('本地恢复记录无法读取，原始文档未改动。'), source: null };
      }
    },
    save(value) {
      let snapshot, content;
      try {
        snapshot = normalizeSession(value); snapshot.at = new Date().toISOString(); content = JSON.stringify(snapshot);
        if (Buffer.byteLength(content, 'utf8') > MAX_SESSION_BYTES) throw invalidRecovery(t('恢复备份总计超过 128 MB，请保存并关闭部分文档后重试。'));
      } catch (error) { return Promise.reject(error); }
      const operation = queued.then(async () => {
        await mkdir(directory, { recursive: true });
        let previous;
        try { previous = (await readSnapshot(primary)).text; }
        catch (error) { if (!['ENOENT'].includes(error.code) && !(error instanceof SyntaxError) && error.code !== 'INVALID_RECOVERY') throw error; }
        if (previous !== undefined) await atomicWrite(backup, previous);
        await atomicWrite(primary, content); await syncDirectory();
        return { ok: true, at: snapshot.at };
      });
      queued = operation.catch(() => {});
      return operation;
    },
  };
}
