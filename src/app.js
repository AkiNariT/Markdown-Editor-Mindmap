import { createEditor } from './editor.js';
import { safeLink, detectUnsupported } from './document.mjs';
import { splitFrontmatter, composeMarkdown } from './frontmatter.mjs';
import { createSourceEditor, toSourceText, fromSourceText } from './source.mjs';
import { fillIcons, icon } from './icons.js';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { createMindmapView } from './mindmap-view.js';
import { parseMindmap, serializeMindmap } from './mindmap.mjs';
import { captureReadingPosition, restoreReadingPosition } from './zoom.mjs';
import { createCheckpointController } from './checkpoint.mjs';
import { createUpdatesUI } from './updates-ui.js';
import { createWindowsDefaultUI } from './windows-default-ui.mjs';
import { t, setLocale, getLocale, onLocaleChange } from './i18n.mjs';

const $ = id => document.getElementById(id);
const api = window.moye;
const updates = createUpdatesUI({ api, t, document });
let editor, current, baseline = '', baselineMetadata = '', documentParts, dirty = false, editing = false, working = false, closing = false, loaded = false, toastTimer;
let linkSelection;
let namingId;
let viewMode = 'render', scrollSyncing = false;
const sessions = new Map();
let tabOrder = [];
let composing = false;
let recoveryStatus = '', recoveryFailure = '';
let changingLanguage = false;
const windowsDefault = createWindowsDefaultUI({ api, t, document, canAct: () => !working && !closing });
// Keep references to application chrome before any document content is mounted.
const localizedElements = [...document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-alt]')];
function applyStaticTranslations() {
  document.documentElement.lang = getLocale();
  for (const node of localizedElements) {
    if (node.hasAttribute('data-i18n')) node.textContent = t(node.getAttribute('data-i18n'));
    for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
      const key = node.getAttribute('data-i18n-' + attribute);
      if (key) node.setAttribute(attribute, t(key));
    }
  }
  $('language-select').value = getLocale();
}
function refreshLanguage() {
  const state = sessions.get(current?.id), canvas = document.querySelector('.canvas');
  const anchor = loaded && state && !state.map && viewMode !== 'source' ? captureReadingPosition(canvas) : null;
  const sourcePosition = state?.source ? { top: state.source.input.scrollTop, left: state.source.input.scrollLeft } : null;
  applyStaticTranslations();
  windowsDefault.refreshLanguage();
  updates.refreshLanguage();
  $('theme-label').textContent = t(document.body.classList.contains('dark') ? '浅色外观' : '黑色外观');
  $('toast').hidden = true;
  if (!loaded || !state) return;
  updateModeLabels(); updateDocumentChrome(); updateStatusLabels(); updateRecoveryStatus(); updateZoomLabel(state);
  renderTabs(); updateNameLabels();
  if (!state.map) { updateOutline(); updateSelection(); }
  const originalLanguage = $('code-language').querySelector('[data-original-language]');
  if (originalLanguage) originalLanguage.textContent = t('原语言：{language}', { language: originalLanguage.value });
  // Only application labels reflow; the editor instances, selections and histories stay intact.
  if (anchor) restoreReadingPosition(canvas, anchor);
  if (sourcePosition) { state.source.input.scrollTop = sourcePosition.top; state.source.input.scrollLeft = sourcePosition.left; }
}
const checkpoint = createCheckpointController({
  collect: collectRecovery,
  write: async value => unpack(await api.checkpoint(value)),
  onState: (status, error) => { recoveryStatus = status; recoveryFailure = error?.message || ''; updateRecoveryStatus(); }
});
fillIcons();
try { document.body.classList.toggle('dark', localStorage.getItem('moye-dark') === 'true'); } catch {}

function isMindmap(value = current) { return value?.type === 'mindmap'; }
function toast(message, long = false) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, long ? 7000 : 2500); }
function unpack(result) { if (result?.error) throw new Error(result.error); return result; }
function hasComposition() { return composing || [...sessions.values()].some(state => state.map?.isComposing() || state.editor?.view.composing); }
function captureView(state) {
  return { editing: state.editing, view: state.view, zoom: state.zoom, ...(state.map ? { map: state.pendingMapView || state.map.captureSessionState() } : {
    outline: state.outline, syncScroll: state.syncScroll, viewScroll: { ...state.viewScroll }, sourceScroll: state.sourceScroll, sourceLeft: state.sourceLeft
  }) };
}
function collectRecovery() {
  if (!loaded || !current || closing || hasComposition()) return null;
  stashActive();
  return { activeId: current.id, documents: [...sessions.values()].map(state => ({
    id: state.current.id, draft: sessionContent(state, false), dirty: Boolean(state.dirty || (!state.current.path && state.current.namedDraft)),
    visualLossy: Boolean(state.visualLossy), viewState: captureView(state)
  })) };
}
function updateRecoveryStatus() {
  const node = $('recovery-state'); if (!node) return;
  const pending = [...sessions.values()].some(state => state.dirty || (!state.current.path && state.current.namedDraft));
  node.textContent = recoveryStatus === 'error' ? t('备份失败') : recoveryStatus === 'saving' ? t('正在备份…') : recoveryStatus === 'saved' ? (pending ? t('草稿已备份') : t('会话已保留')) : '';
  node.classList.toggle('recovery-error', recoveryStatus === 'error');
  node.title = recoveryFailure || t('草稿和阅读位置自动保存在本机。原始文件仍需点击保存。');
}
function applyRecovery(state, recovery) {
  if (!recovery) return state;
  const view = recovery.viewState || {};
  state.zoom = view.zoom ?? 100; state.editing = view.editing ?? state.editing;
  if (state.map) {
    if (typeof recovery.draft === 'string') state.map.setSaved(parseMindmap(recovery.draft));
    state.dirty = state.map.getText() !== state.baselineMap;
    state.pendingMapView = view.map;
    return state;
  }
  if (typeof recovery.draft === 'string' && recovery.draft !== state.current.content) {
    state.source.setText(toSourceText(recovery.draft), { context: { lossy: Boolean(recovery.visualLossy) } }); state.authority = 'source';
    state.visualLossy = Boolean(recovery.visualLossy); state.visualOriginal = recovery.draft; state.dirty = true;
    replacePreview(state, recovery.draft);
  }
  state.view = ['render', 'source', 'compare'].includes(view.view) ? view.view : 'render';
  state.outline = Boolean(view.outline); state.syncScroll = view.syncScroll !== false;
  state.viewScroll = { render: view.viewScroll?.render || 0, compare: view.viewScroll?.compare || 0 };
  state.sourceScroll = view.sourceScroll || 0; state.sourceLeft = view.sourceLeft || 0;
  state.viewZoom = { render: state.zoom, compare: state.zoom };
  state.viewsSeen.add(state.view); if (state.view === 'compare') state.viewsSeen.add('source');
  return state;
}
function hideMenus() { $('more-menu').hidden = true; $('more-toggle').setAttribute('aria-expanded', 'false'); }
function updateModeLabels() {
  $('mode').setAttribute('aria-label', editing ? t('阅读') : t('编辑'));
  $('mode').innerHTML = icon(editing ? 'read' : 'edit') + `<span>${editing ? t('阅读') : t('编辑')}</span>`;
  const copy = sessions.get(current?.id)?.visualLossy;
  $('page-mode').textContent = viewMode === 'render' ? (editing ? t('编 辑') : t('阅 读')) : viewMode === 'source' ? (editing ? (copy ? t('源码 · 编辑副本') : t('源码 · 编辑')) : t('源码 · 阅读')) : (copy ? t('实时对照 · 编辑副本') : t('实时对照'));
}
function setMode(value) {
  editing = value; setInputPermissions(); updateModeLabels();
  if (isMindmap()) { document.body.classList.remove('editing'); hideMenus(); updateSelection(); return; }
  $('edit-controls').hidden = !editing || !visualView(); document.body.classList.toggle('editing', editing);
  hideMenus(); updateSelection();
}
function imageURL(src, value = current) {
  if (/^https?:\/\//i.test(src)) return src;
  if (!value?.path || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return '';
  return `moye-image://${value.imageKey}/${encodeURIComponent(src)}`;
}
function skillValues() { return documentParts?.skill ? { name: $('skill-name').value, description: $('skill-description').value } : undefined; }
function metadataSignature() { return JSON.stringify(skillValues()) || ''; }
function metadataFocused() { return $('skill-fields').contains(document.activeElement); }
function visualView() { return viewMode === 'render' || viewMode === 'compare'; }
function readDocumentParts(value) { const parts = splitFrontmatter(value.content); if (parts && !value.skillDocument) parts.skill = null; return parts; }
function setMetadataEditable() { for (const id of ['skill-name', 'skill-description']) $(id).readOnly = !editing || !visualView() || working || closing; }
function setInputPermissions() {
  windowsDefault.setLocked(working || closing);
  editor?.setEditable(editing && visualView() && !working && !closing, false); setMetadataEditable();
  const state = sessions.get(current?.id);
  if (state?.source) state.source.input.readOnly = !editing || working || closing;
  state?.map?.setLocked?.(working || closing);
  state?.map?.setEditable(editing);
  for (const id of ['open', 'new', 'save', 'save-as', 'mode', 'skill-template', 'zoom-out', 'zoom-reset', 'zoom-in', 'rename', 'name-confirm', 'name-cancel', 'new-mindmap', 'settings', 'check-updates', 'settings-check-updates']) $(id).disabled = working || closing;
  $('filename').readOnly = working || closing;
  for (const button of $('view-switch').querySelectorAll('button')) button.disabled = working || closing;
  $('sync-scroll').disabled = working || closing;
  $('outline-toggle').disabled = isMindmap() || viewMode === 'source' || working || closing;
}
function sourceSafe(state) { return state?.authority === 'source' && !state.visualLossy; }
function markVisualChange(state) {
  if (viewMode === 'compare') {
    clearTimeout(state.previewTimer); state.previewPending = false; const revision = ++state.previewRevision;
    const projected = state.editor.getMarkdown().trimEnd() === state.projection.markdown && metadataSignature() === state.projection.metadata;
    const lossy = projected ? state.projection.lossy : state.visualLossy || detectUnsupported(state.visualOriginal).length > 0;
    const text = projected ? state.projection.content : composeMarkdown(state.editor.getMarkdown(), state.visualOriginal, skillValues(), { validate: false });
    state.source.setText(toSourceText(text), { record: true, context: { lossy } });
    state.visualLossy = lossy; state.authority = 'source'; state.visualOriginal = text;
    state.documentParts = readDocumentParts({ ...state.current, content: text }); documentParts = state.documentParts;
    state.metadata = skillValues(); updateDocumentChrome(); updateState();
    cachePreview(state, text, revision).catch(error => toast(error.message, true)); return;
  }
  if (state.editor.getMarkdown().trimEnd() === state.projection.markdown && metadataSignature() === state.projection.metadata) {
    state.authority = 'source'; state.visualLossy = state.projection.lossy; state.visualOriginal = state.projection.content;
    state.source.setText(toSourceText(state.projection.content), { record: state.viewsSeen.has('compare'), context: { lossy: state.visualLossy } });
  } else { state.authority = 'visual'; state.visualLossy ||= detectUnsupported(state.visualOriginal).length > 0; }
  updateState();
}
function sessionContent(state, validate = true) {
  if (state.map) return state.map.getText();
  if (state.authority === 'source') return fromSourceText(state.source.getText(), state.current.content);
  return state.dirty ? composeMarkdown(state.editor.getMarkdown(), state.visualOriginal, state.metadata, { validate }) : state.current.content;
}
function content() { stashActive(); return sessionContent(sessions.get(current.id)); }
function stashActive() {
  const state = sessions.get(current?.id); if (!state || !loaded) return;
  if (state.map) { state.map.capturePosition(); Object.assign(state, { current, dirty, editing }); return; }
  if (viewMode !== 'source') {
    const canvas = document.querySelector('.canvas');
    state.viewScroll[viewMode] = canvas.scrollTop; state.viewZoom[viewMode] = state.zoom;
    state.viewAnchors[viewMode] = captureReadingPosition(canvas); state.outline = !$('outline').hidden;
  }
  if (viewMode !== 'render') { state.sourceScroll = state.source.input.scrollTop; state.sourceLeft = state.source.input.scrollLeft; }
  Object.assign(state, { current, editor, baseline, baselineMetadata, documentParts, dirty, editing, metadata: skillValues(), scroll: state.viewScroll.render, view: viewMode });
}
function createSession(value, mountEditor = false) {
  if (isMindmap(value)) {
    const state = { current: value, dirty: false, editing: Boolean(value.editable), zoom: 100, view: 'mindmap' };
    state.map = createMindmapView(value.mapData, {
      onChange: () => {
        state.dirty = state.map.getText() !== state.baselineMap;
        api.setDirty(state.current.id, state.dirty);
        if (loaded && current?.id === value.id) updateState(); else renderTabs();
      },
      onLink: async () => action(async () => { const result = unpack(await api.chooseMindmapFile()); return result.canceled ? null : result.path; }),
      onCreate: async nodeId => action(async () => { await checkpoint.flush(); return unpack(await api.createMindmapFile(state.current.id, state.map.getText(), nodeId)); }),
      onOpen: async (nodeId, options = {}) => action(async () => {
        await checkpoint.flush();
        return unpack(await api.openMindmapFile(state.current.id, state.map.getText(), nodeId, options.created === true));
      }),
      onEdit: async () => { if (current?.id === state.current.id && !editing) await toggleMode(); },
      onError: message => toast(message, true),
    });
    state.host = state.map.host; state.baselineMap = state.map.getText(); return applyRecovery(state, value.recovery);
  }
  const parts = readDocumentParts(value);
  const state = { current: value, documentParts: parts, metadata: parts?.skill ? { name: parts.skill.name, description: parts.skill.description } : undefined, editing: Boolean(value.editable), dirty: false, scroll: 0, outline: false, host: document.createElement('div'), view: 'render', viewScroll: { render: 0, compare: 0 }, sourceScroll: 0, syncScroll: true, authority: 'visual', visualOriginal: value.content, visualLossy: false, previewPending: false };
  state.source = createSourceEditor(context => { const live = sessions.get(value.id); if (loaded && live && current?.id === value.id) sourceInput(live, context); });
  state.source.setText(toSourceText(value.content));
  state.source.input.addEventListener('scroll', () => { if (loaded && current?.id === value.id) syncScroll('source'); });
  state.editor = createEditor(mountEditor ? state.host : null, parts ? parts.body : value.content, { editable: false, imageURL: src => imageURL(src, state.current),
    onUpdate: ({ transaction }) => { if (loaded && visualView() && transaction.docChanged && current?.id === value.id) markVisualChange(state); },
    onSelectionUpdate: () => { if (loaded && current?.id === value.id) updateSelection(); } });
  state.baseline = state.editor.getMarkdown().trimEnd();
  state.baselineMetadata = JSON.stringify(state.metadata) || '';
  state.baselinePrefix = parts?.prefix || '';
  state.projection = { markdown: state.baseline, metadata: state.baselineMetadata, content: value.content, lossy: false };
  state.viewsSeen = new Set(['render']);
  state.previewRevision = 0;
  state.zoom = 100; state.viewZoom = { render: 100, compare: 100 }; state.viewAnchors = {}; state.sourceLeft = 0;
  applyRecovery(state, value.recovery);
  // Background sessions start with document state only; create their view when selected.
  state.editorMounted = mountEditor;
  return state;
}
function contentFor(id) {
  if (id === current?.id) return content();
  const state = sessions.get(id); if (!state) throw new Error(t('文档标签已关闭。'));
  return sessionContent(state);
}
function sourceInput(state, context) {
  if (context) state.visualLossy = context.lossy;
  state.authority = 'source'; state.previewPending = true;
  state.visualOriginal = fromSourceText(state.source.getText(), state.current.content);
  state.documentParts = readDocumentParts({ ...state.current, content: state.visualOriginal });
  state.metadata = state.documentParts?.skill ? { ...state.documentParts.skill } : undefined;
  documentParts = state.documentParts; $('skill-name').value = state.metadata?.name || ''; $('skill-description').value = state.metadata?.description || '';
  updateDocumentChrome(); updateState(); clearTimeout(state.previewTimer);
  if (viewMode === 'compare') refreshPreview(state).catch(error => toast(error.message, true));
}
function replacePreview(state, text) {
  const active = current?.id === state.current.id, wasLoaded = loaded; if (active) loaded = false;
  const canvas = document.querySelector('.canvas'), scroll = canvas.scrollTop;
  const selection = state.editor.state.selection;
  if (active) scrollSyncing = true;
  try {
    state.documentParts = readDocumentParts({ ...state.current, content: text });
    state.metadata = state.documentParts?.skill ? { ...state.documentParts.skill } : undefined;
    state.editor.chain().setContent((state.documentParts ? state.documentParts.body : text).replace(/^\ufeff/, ''), { contentType: 'markdown', emitUpdate: false })
      .command(({ tr }) => {
        closeHistory(tr); tr.setMeta('addToHistory', false);
        tr.setSelection(TextSelection.between(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size)), tr.doc.resolve(Math.min(selection.to, tr.doc.content.size))));
        return true;
      }).run();
    state.visualOriginal = text; state.previewPending = false;
    state.projection = { markdown: state.editor.getMarkdown().trimEnd(), metadata: JSON.stringify(state.metadata) || '', content: text, lossy: state.visualLossy };
    if (active) { documentParts = state.documentParts; $('skill-name').value = state.metadata?.name || ''; $('skill-description').value = state.metadata?.description || ''; updateDocumentChrome(); }
  } finally { if (active) loaded = wasLoaded; }
  if (active) { canvas.scrollTo({ top: scroll, behavior: 'instant' }); updateOutline(); updateSelection(); requestAnimationFrame(() => { scrollSyncing = false; }); }
}
async function refreshPreview(state) {
  clearTimeout(state.previewTimer); if (!state.previewPending) return;
  const text = fromSourceText(state.source.getText(), state.current.content);
  const revision = ++state.previewRevision, immediate = state.view === 'compare';
  // Render synchronously before the user can type in the other pane.
  if (immediate) replacePreview(state, text);
  if (await cachePreview(state, text, revision) && !immediate) replacePreview(state, text);
}
async function cachePreview(state, text, revision) {
  unpack(await api.cacheSource(state.current.id, text));
  if (sessions.get(state.current.id) !== state || revision !== state.previewRevision || toSourceText(text) !== state.source.getText()) return false;
  for (const img of state.host.querySelectorAll('img[src^="moye-image:"]')) {
    // A newly typed local image may have requested access before the native cache arrived.
    if (!img.complete || !img.naturalWidth) { const url = new URL(img.src); url.searchParams.set('preview', revision); img.src = url.href; }
  }
  return true;
}
function applyView(state) {
  viewMode = state.view;
  applyZoom(state);
  $('document-pane').classList.toggle('source-view', viewMode === 'source'); $('document-pane').classList.toggle('compare-view', viewMode === 'compare');
  $('source-container').hidden = viewMode === 'render'; document.querySelector('.canvas').hidden = viewMode === 'source';
  $('sync-scroll-control').hidden = viewMode !== 'compare'; $('sync-scroll').checked = state.syncScroll;
  for (const button of $('view-switch').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === viewMode));
  toggleOutline(viewMode === 'source' ? false : state.outline); setMode(state.editing);
}
async function switchView(next) {
  if (!current || isMindmap() || next === viewMode) return;
  await action(async () => {
    stashActive(); const state = sessions.get(current.id);
    const origin = viewMode === 'source' ? state.source.input : document.querySelector('.canvas');
    const range = origin.scrollHeight - origin.clientHeight, progress = range > 0 ? origin.scrollTop / range : 0;
    const seen = state.viewsSeen.has(next), sourceSeen = state.viewsSeen.has('source');
    if (state.authority === 'visual') {
      state.source.closeGroup();
      state.source.setText(toSourceText(sessionContent(state, false)), { record: next === 'compare' || state.viewsSeen.has('compare'), context: { lossy: state.visualLossy } });
      if (!state.dirty) state.authority = 'source';
    }
    if (next !== 'source') await refreshPreview(state);
    state.view = next; applyView(state);
    const canvas = document.querySelector('.canvas'); scrollSyncing = true;
    if (seen && next !== 'source' && state.viewZoom[next] !== state.zoom) restoreReadingPosition(canvas, state.viewAnchors[next]);
    else canvas.scrollTo({ top: seen ? state.viewScroll[next] || 0 : progress * Math.max(0, canvas.scrollHeight - canvas.clientHeight), behavior: 'instant' });
    state.source.input.scrollTop = sourceSeen ? state.sourceScroll : progress * Math.max(0, state.source.input.scrollHeight - state.source.input.clientHeight);
    state.source.input.scrollLeft = state.sourceLeft;
    state.viewsSeen.add(next); if (next === 'compare') state.viewsSeen.add('source');
    state.source.refresh(); updateState(); requestAnimationFrame(() => { scrollSyncing = false; });
  });
}
function syncScroll(from) {
  const state = sessions.get(current?.id); if (!state || viewMode !== 'compare' || !state.syncScroll || working || closing || scrollSyncing) return;
  const source = state.source.input, preview = document.querySelector('.canvas');
  const origin = from === 'source' ? source : preview, target = from === 'source' ? preview : source;
  const range = origin.scrollHeight - origin.clientHeight;
  scrollSyncing = true; target.scrollTo({ top: range > 0 ? origin.scrollTop / range * (target.scrollHeight - target.clientHeight) : 0, behavior: 'instant' });
  requestAnimationFrame(() => { scrollSyncing = false; });
}
function applyZoom(state) {
  state.map?.setZoom(state.zoom);
  $('document-pane').style.setProperty('--document-zoom', state.zoom / 100);
  $('zoom-reset').textContent = state.zoom + '%';
  updateZoomLabel(state);
}
function updateZoomLabel(state) { $('zoom-reset').setAttribute('aria-label', t('当前缩放 {zoom}%，点击恢复 100%', { zoom: state.zoom })); }
function changeZoom(value) {
  const state = sessions.get(current?.id);
  if (!loaded || !state || working || closing || document.querySelector('dialog[open]')) return;
  const next = Math.max(50, Math.min(200, value)); if (next === state.zoom) return;
  stashActive(); checkpoint.schedule();
  if (state.map) { state.zoom = next; applyZoom(state); state.map.capturePosition(); return; }
  const ratio = next / state.zoom, canvas = document.querySelector('.canvas');
  scrollSyncing = true;
  state.zoom = next; state.sourceScroll *= ratio; state.sourceLeft *= ratio;
  applyZoom(state);
  if (viewMode !== 'source') restoreReadingPosition(canvas, state.viewAnchors[viewMode]);
  if (viewMode !== 'render') { state.source.input.scrollTop = state.sourceScroll; state.source.input.scrollLeft = state.sourceLeft; }
  state.source.refresh(); stashActive(); updateSelection();
  requestAnimationFrame(() => { scrollSyncing = false; });
}
function stepZoom(direction) { changeZoom((sessions.get(current?.id)?.zoom || 100) + direction * 10); }
function renderTabs() {
  const nav = $('document-tabs'), scroll = nav.scrollLeft; nav.replaceChildren();
  for (const info of tabOrder) {
    const state = sessions.get(info.id), value = state?.current || info;
    const name = value.path ? value.path.split(/[\\/]/).pop() : (value.suggestedName || t('未命名'));
    const item = document.createElement('div'); item.className = 'document-tab'; item.classList.toggle('active', current?.id === info.id);
    const button = document.createElement('button'); button.setAttribute('role', 'tab'); button.id = 'tab-' + info.id; button.dataset.documentId = info.id;
    button.setAttribute('aria-label', name); button.setAttribute('aria-selected', String(current?.id === info.id)); button.setAttribute('aria-controls', isMindmap(value) ? 'mindmap-pane' : 'document-pane'); button.tabIndex = current?.id === info.id ? 0 : -1; button.disabled = working || closing;
    button.title = value.path || name;
    const label = document.createElement('span'); label.className = 'tab-name'; label.textContent = (isMindmap(value) ? '◇ ' : '') + name; button.append(label);
    if (state ? state.dirty || (!value.path && value.namedDraft) : info.dirty) { const dot = document.createElement('span'); dot.className = 'tab-dirty'; dot.textContent = '•'; dot.setAttribute('aria-label', t('未保存')); button.append(dot); }
    button.addEventListener('click', () => action(async () => unpack(await api.activateTab(info.id))));
    const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', t('关闭 {name}', { name })); close.title = t('关闭文档'); close.disabled = working || closing;
    close.addEventListener('click', () => action(async () => unpack(await api.closeTab(info.id))));
    item.append(button, close); nav.append(item);
  }
  nav.scrollLeft = scroll;
  if (current) $('document-pane').setAttribute('aria-labelledby', 'tab-' + current.id);
}
function revealActiveTab() {
  const nav = $('document-tabs'), item = nav.querySelector('.document-tab.active'); if (!item) return;
  const bar = nav.getBoundingClientRect(), tab = item.getBoundingClientRect();
  if (tab.left < bar.left + 8) nav.scrollBy({ left: tab.left - bar.left - 8, behavior: 'instant' });
  else if (tab.right > bar.right - 8) nav.scrollBy({ left: tab.right - bar.right + 8, behavior: 'instant' });
}
function updateDocumentChrome() {
  $('document-name').textContent = current.path ? current.path.split(/[\\/]/).pop() : (current.suggestedName || (current.content ? t('欢迎') : t('未命名')));
  $('rename').title = (current.path ? t('重命名文件') : t('命名文件')) + ' · F2';
  $('file-path').textContent = current.path || t('保存在你的电脑上'); $('file-path').title = current.path || '';
  if (isMindmap()) return;
  $('frontmatter-info').hidden = !documentParts;
  $('skill-fields').hidden = !documentParts?.skill;
  $('metadata-note').textContent = documentParts?.skill ? t('名称与用途会一并保存，正文在下方直接编辑。') : t('文件头信息会随正文一同保留。');
  const state = sessions.get(current.id), unsupported = detectUnsupported(state.visualOriginal);
  $('protection').hidden = !unsupported.length && !state.visualLossy;
  $('protection-text').textContent = state.visualLossy ? t('正文编辑可能改变部分特殊格式，保存时需要另存副本。') : t(viewMode === 'compare' ? '包含 {formats}。这些格式可能显示不完整；仅编辑源码会保留，修改正文后需要另存副本。' : '包含 {formats}。正文模式暂不能完整编辑；可使用源码模式编辑，正文编辑后需要另存副本。', { formats: unsupported.join(getLocale() === 'en' ? ', ' : '、') });
}
function updateStatusLabels() {
  const state = sessions.get(current?.id); if (!state) return;
  const pending = state.dirty || (!current.path && current.namedDraft);
  $('save-state').textContent = pending ? t('尚未保存') : (current.path ? t('已保存') : state.map ? t('本地导图') : t('本地文档'));
  $('word-count').textContent = state.map ? t('{count} 个主题', { count: state.map.getData().nodes.length.toLocaleString(getLocale()) }) : t('{count} 字', { count: [...(state.authority === 'source' ? state.source.getText() : state.editor.getText()).replace(/\s/g, '')].length.toLocaleString(getLocale()) });
}
function updateState() {
  checkpoint.schedule(); updateRecoveryStatus();
  if (isMindmap()) {
    const state = sessions.get(current.id); if (!state?.map) return;
    dirty = state.map.getText() !== state.baselineMap; state.dirty = dirty;
    const pending = dirty || (!current.path && current.namedDraft);
    api.setDirty(current.id, dirty); $('dirty-dot').hidden = !pending;
    updateStatusLabels();
    stashActive(); renderTabs(); return;
  }
  if (!editor || !current) return;
  const state = sessions.get(current.id);
  dirty = state.authority === 'source' ? fromSourceText(state.source.getText(), current.content) !== current.content : editor.getMarkdown().trimEnd() !== baseline || metadataSignature() !== baselineMetadata || (documentParts?.prefix || '') !== state.baselinePrefix;
  state.dirty = dirty;
  const pending = dirty || (!current.path && current.namedDraft);
  api.setDirty(current.id, dirty, state.visualLossy); $('dirty-dot').hidden = !pending;
  updateStatusLabels();
  stashActive(); renderTabs(); updateOutline(); updateSelection();
}
function loadDocument(docData) {
  sessions.get(current?.id)?.map?.setLocked?.(true);
  stashActive(); editor?.view.dom.blur(); sessions.get(current?.id)?.source?.input.blur(); loaded = false;
  const previous = sessions.get(current?.id);
  if (previous?.editorMounted && current.id !== docData.id) {
    previous.editor.unmount(); previous.editorMounted = false;
  }
  if (docData.tabs) tabOrder = docData.tabs;
  if (!sessions.has(docData.id)) sessions.set(docData.id, createSession(docData, true));
  const state = sessions.get(docData.id);
  $('document-pane').hidden = Boolean(state.map); $('mindmap-pane').hidden = !state.map; $('view-switch').hidden = Boolean(state.map);
  if (state.map) {
    current = state.current; editor = undefined; documentParts = null; dirty = state.dirty; viewMode = 'mindmap';
    toggleOutline(false); $('mindmap-pane').replaceChildren(state.host); applyZoom(state); setMode(state.editing); updateDocumentChrome();
    if (state.pendingMapView) { state.map.restoreSessionState(state.pendingMapView); state.pendingMapView = null; }
    state.map.restorePosition(); loaded = true; updateState();
    requestAnimationFrame(() => { if (current?.id === state.current.id) state.map.restorePosition(); });
    renderTabs(); revealActiveTab(); return;
  }
  const scroll = state.viewScroll[state.view] || 0, sourceScroll = state.sourceScroll, sourceLeft = state.sourceLeft;
  if (!state.editorMounted) { state.editor.mount(state.host); state.editorMounted = true; }
  ({ current, editor, baseline, baselineMetadata, documentParts, dirty } = state);
  $('editor').replaceChildren(state.host);
  $('source-container').replaceChildren(state.source.host);
  $('skill-name').value = state.metadata?.name || '';
  $('skill-description').value = state.metadata?.description || '';
  applyView(state); updateDocumentChrome();
  loaded = true; updateState();
  scrollSyncing = true;
  const canvas = document.querySelector('.canvas'); canvas.scrollTo({ top: scroll, behavior: 'instant' });
  state.source.input.scrollTop = sourceScroll; state.source.refresh();
  state.source.input.scrollLeft = sourceLeft;
  requestAnimationFrame(() => { scrollSyncing = false; });
  if (state.view !== 'source' && state.previewPending) refreshPreview(state).catch(error => toast(error.message, true));
  renderTabs(); revealActiveTab();
}
function updateOutline() {
  const nav = $('outline-items'); nav.replaceChildren();
  const headings = $('editor').querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (!headings.length) { const p = document.createElement('p'); p.className = 'empty-outline'; p.textContent = t('标题会显示在这里'); nav.append(p); return; }
  headings.forEach(heading => {
    const button = document.createElement('button'); button.textContent = heading.textContent || t('未命名标题');
    button.className = 'level-' + Math.min(Number(heading.tagName.slice(1)), 3);
    button.addEventListener('click', () => { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (window.innerWidth < 761) toggleOutline(false); });
    nav.append(button);
  });
}
function updateSelection() {
  const toolbar = $('selection-toolbar');
  if (!editor || !loaded) { toolbar.hidden = true; $('table-tools').hidden = true; return; }
  updateQuickFormatting();
  $('table-tools').hidden = !(editing && visualView() && editor.isActive('table'));
  if (!editing || !visualView() || working || closing || metadataFocused() || editor.state.selection.empty || !(editor.state.selection instanceof TextSelection)) { toolbar.hidden = true; return; }
  const selection = window.getSelection();
  if (!selection?.rangeCount || !$('editor').contains(selection.anchorNode)) { toolbar.hidden = true; return; }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  toolbar.hidden = false;
  const width = toolbar.offsetWidth;
  toolbar.style.left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left + rect.width / 2 - width / 2)) + 'px';
  toolbar.style.top = Math.max(document.querySelector('.page-bar').getBoundingClientRect().bottom + 8, rect.top - 49) + 'px';
  for (const name of ['bold', 'italic', 'strike']) toolbar.querySelector(`[data-command="${name}"]`).classList.toggle('active', editor.isActive(name));
}
function updateQuickFormatting() {
  for (const control of $('edit-controls').querySelectorAll('select,button')) control.disabled = working || closing || metadataFocused();
  let style = 'paragraph';
  for (let level = 1; level <= 6; level++) if (editor.isActive('heading', { level })) { style = String(level); break; }
  $('block-style').value = style;
  $('edit-controls').querySelectorAll('[data-command][aria-pressed]').forEach(button => {
    const active = editor.isActive(button.dataset.command);
    button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
  });
  const inCode = editing && visualView() && !metadataFocused() && editor.isActive('codeBlock');
  $('code-language-picker').hidden = !inCode;
  if (inCode) {
    const language = editor.getAttributes('codeBlock').language || '';
    const select = $('code-language');
    const originalOption = select.querySelector('[data-original-language]');
    if (originalOption && originalOption.value !== language) originalOption.remove();
    if (![...select.options].some(option => option.value === language)) {
      const option = document.createElement('option');
      option.value = language; option.textContent = t('原语言：{language}', { language });
      option.dataset.originalLanguage = ''; select.append(option);
    }
    select.value = language;
  }
}
async function action(callback) {
  if (sessions.get(current?.id)?.map?.isComposing()) { toast(t('请先完成节点文字输入，再进行操作。')); return; }
  if (working || closing) return; working = true; setInputPermissions(); updateSelection(); renderTabs();
  try { return await callback(); } catch (error) { toast(error.message, true); } finally { working = false; setInputPermissions(); updateSelection(); renderTabs(); checkpoint.schedule(); }
}
async function save(as = false) {
  const result = unpack(await api.save(content(), as, sourceSafe(sessions.get(current.id))));
  if (result.canceled) return;
  applySaved(result);
  toast(result.mindmapLinkSkipped ? t('文档已保存；原导图或节点已变化，请按需手动关联。') : result.unchanged ? t('没有需要保存的修改') : t('已保存'));
}
function updateNameLabels() {
  $('name-heading').textContent = current.path ? t('重命名文件') : t('命名文件');
  $('name-note').textContent = t(current.path ? (isMindmap() ? '在当前目录更改导图文件名，未保存的节点会继续保留。未填写扩展名时自动补全 {extension}。' : '在当前目录更改文件名，未保存的正文会继续保留。未填写扩展名时自动补全 {extension}。') : '无需先保存，保存时会使用这个名称。未填写扩展名时自动补全 {extension}。', { extension: isMindmap() ? '.mdmap' : '.md' });
}
function showNameDialog() {
  if (!current || working || closing || document.querySelector('dialog[open]')) return;
  namingId = current.id; hideMenus(); updateNameLabels();
  $('filename').value = current.path ? current.path.split(/[\\/]/).pop() : current.suggestedName || '';
  $('name-error').hidden = true; $('name-dialog').showModal();
  $('filename').focus(); $('filename').setSelectionRange(0, $('filename').value.replace(/\.(md|markdown|mdmap)$/i, '').length);
}
function applyRenamed(result) {
  stashActive(); const state = sessions.get(result.id); if (!state) return;
  if (result.renamedFrom && !isMindmap(result)) {
    for (const target of sessions.values()) target.map?.replaceFile(result.renamedFrom, result.path);
  }
  if (state.map) {
    state.current = { ...state.current, ...result }; if (result.tabs) tabOrder = result.tabs;
    if (current?.id === result.id) { current = state.current; updateDocumentChrome(); updateState(); } else renderTabs();
    revealActiveTab(); return;
  }
  const raw = sessionContent(state, false), changedKind = state.current.skillDocument !== result.skillDocument;
  // Naming changes metadata only; editor instances, buffers and histories stay alive.
  state.current = { ...state.current, ...result };
  if (changedKind) {
    state.documentParts = readDocumentParts({ ...state.current, content: raw });
    state.metadata = state.documentParts?.skill ? { ...state.documentParts.skill } : undefined;
    state.baselineMetadata = JSON.stringify(readDocumentParts(state.current)?.skill || undefined) || '';
    state.projection.metadata = JSON.stringify(readDocumentParts({ ...state.current, content: state.projection.content })?.skill || undefined) || '';
  }
  if (result.tabs) tabOrder = result.tabs;
  if (current?.id === result.id) {
    ({ current, documentParts, baselineMetadata } = state);
    $('skill-name').value = state.metadata?.name || ''; $('skill-description').value = state.metadata?.description || '';
    updateDocumentChrome(); updateState();
  } else renderTabs();
  revealActiveTab();
}
$('rename').addEventListener('click', showNameDialog);
$('name-cancel').addEventListener('click', () => $('name-dialog').close());
$('filename').addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });
$('name-dialog').addEventListener('cancel', event => { if (working || closing) event.preventDefault(); });
$('name-form').addEventListener('submit', event => {
  event.preventDefault(); if (working || closing) return;
  action(async () => {
    try {
      const result = unpack(await api.renameDocument(namingId, $('filename').value));
      applyRenamed(result); $('name-dialog').close(); toast(result.path ? t('文件已重命名') : t('已命名，保存时将沿用此名称'));
    } catch (error) { $('name-error').textContent = error.message; $('name-error').hidden = false; }
  });
});
function applySaved(result) {
  stashActive();
  if (result.linkedMindmap) {
    const { id, nodeId, path } = result.linkedMindmap;
    sessions.get(id)?.map?.attachFile(nodeId, path);
  }
  let state = sessions.get(result.id); if (!state) return;
  if (result.tabs) tabOrder = result.tabs;
  const active = current?.id === result.id;
  if (state.map) {
    state.current = result; state.map.setSaved(result.mapData); state.baselineMap = serializeMindmap(result.mapData); state.dirty = state.map.getText() !== state.baselineMap;
    if (active) { current = result; dirty = state.dirty; updateDocumentChrome(); updateState(); }
    renderTabs(); return;
  }
  const position = state.editor.state.selection.from;
  const samePath = state.current.path === result.path;
  clearTimeout(state.previewTimer);
  if (state.viewsSeen.has('compare') && state.authority === 'visual' && toSourceText(sessionContent(state, false)) === toSourceText(result.content)) {
    state.source.closeGroup();
    state.source.setText(toSourceText(result.content), { record: true, context: { lossy: false } });
  }
  if (samePath) {
    state.current = result;
    if (state.authority === 'source') replacePreview(state, result.content);
    state.source.setText(toSourceText(result.content), { context: { lossy: false } });
    Object.assign(state, { documentParts: readDocumentParts(result), visualOriginal: result.content, baseline: state.editor.getMarkdown().trimEnd(), baselineMetadata: JSON.stringify(state.metadata) || '', baselinePrefix: readDocumentParts(result)?.prefix || '', dirty: false, visualLossy: false });
    state.projection = { markdown: state.baseline, metadata: state.baselineMetadata, content: result.content, lossy: false };
    if (active) { ({ current, documentParts, baseline, baselineMetadata, dirty } = state); updateDocumentChrome(); updateState(); }
  } else {
    const replacement = createSession(result, active);
    if (state.source.getText() === toSourceText(result.content)) {
      replacement.source.destroy(); replacement.source = state.source;
      replacement.source.setText(toSourceText(result.content), { context: { lossy: false } });
    } else state.source.destroy();
    Object.assign(replacement, { editing: state.editing, scroll: state.scroll, outline: state.outline, view: state.view, viewScroll: { ...state.viewScroll }, sourceScroll: state.sourceScroll, sourceLeft: state.sourceLeft, zoom: state.zoom, viewZoom: { ...state.viewZoom }, viewAnchors: { ...state.viewAnchors }, syncScroll: state.syncScroll, authority: state.authority, viewsSeen: new Set(state.viewsSeen) });
    replacement.source.input.setSelectionRange(Math.min(state.source.input.selectionStart, replacement.source.getText().length), Math.min(state.source.input.selectionEnd, replacement.source.getText().length));
    if (active) loaded = false;
    state.editor.destroy(); sessions.set(result.id, replacement); state = replacement;
    state.editor.commands.setTextSelection(Math.min(position, state.editor.state.doc.content.size));
    if (active) { current = null; editor = undefined; loaded = false; loadDocument(result); }
  }
  renderTabs();
}
async function toggleMode() {
  if (working || closing) return;
  if (isMindmap()) {
    await action(async () => { if (!editing) unpack(await api.confirmEdit(true)); setMode(!editing); });
    stashActive(); return;
  }
  const canvas = document.querySelector('.canvas');
  const bodyTop = $('editor').getBoundingClientRect().top;
  const sourceTop = sessions.get(current.id).source.input.scrollTop;
  await action(async () => {
    if (editing) { setMode(false); return; }
    const result = unpack(await api.confirmEdit(viewMode !== 'render' && !sessions.get(current.id).visualLossy)); if (result.canceled) return;
    setMode(true);
    if (viewMode === 'render') editor.commands.focus(null, { scrollIntoView: false });
    else sessions.get(current.id).source.input.focus({ preventScroll: true });
  });
  if (viewMode === 'source') return;
  scrollSyncing = true;
  // Match physical pixels so display scaling cannot accumulate rounding drift.
  const shift = Math.round(($('editor').getBoundingClientRect().top - bodyTop) * 100) / 100;
  const pixels = Math.sign(shift) * Math.round(Math.abs(shift) * window.devicePixelRatio) / window.devicePixelRatio;
  canvas.scrollBy({ top: pixels, behavior: 'instant' });
  if (viewMode === 'compare') sessions.get(current.id).source.input.scrollTop = sourceTop;
  requestAnimationFrame(() => { scrollSyncing = false; });
}
function toggleOutline(force) {
  const shown = force ?? $('outline').hidden; $('outline').hidden = !shown;
  $('outline-toggle').setAttribute('aria-expanded', String(shown));
  $('outline-toggle').classList.toggle('active', shown);
}
function cycleTabs(step) {
  const index = tabOrder.findIndex(value => value.id === current?.id);
  const next = tabOrder[(index + step + tabOrder.length) % tabOrder.length];
  if (next) return action(async () => unpack(await api.activateTab(next.id)));
}
function toggleMenu(id, anchor) {
  const show = $(id).hidden; hideMenus(); if (!show) return;
  const menu = $(id), rect = anchor.getBoundingClientRect(); menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth)) + 'px';
  menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 40, rect.bottom + 8) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
}
function showLink() {
  linkSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
  $('link-text').value = editor.state.doc.textBetween(linkSelection.from, linkSelection.to, ' ');
  $('link-url').value = editor.getAttributes('link').href || '';
  $('link-error').hidden = true; $('link-dialog').showModal(); $('link-url').focus();
}
async function command(name) {
  if (!editing || !visualView() || working || closing) return;
  hideMenus();
  if (name === 'link') { showLink(); return; }
  if (name === 'table') { $('table-dialog').showModal(); return; }
  if (name === 'image') {
    await action(async () => { const result = unpack(await api.insertImage()); if (result.canceled) return; editor.chain().focus().setImage({ src: result.src, alt: result.alt }).run(); }); return;
  }
  const chain = editor.chain().focus();
  const commands = { bold: () => chain.toggleBold(), italic: () => chain.toggleItalic(), strike: () => chain.toggleStrike(), heading1: () => chain.toggleHeading({ level: 1 }), heading2: () => chain.toggleHeading({ level: 2 }), paragraph: () => chain.setParagraph(), bulletList: () => chain.toggleBulletList(), orderedList: () => chain.toggleOrderedList(), taskList: () => chain.toggleTaskList(), blockquote: () => chain.toggleBlockquote(), codeBlock: () => chain.toggleCodeBlock(), horizontalRule: () => chain.setHorizontalRule() };
  commands[name]?.().run(); updateState();
}
$('outline-toggle').addEventListener('click', () => { toggleOutline(); checkpoint.schedule(); });
$('open').addEventListener('click', () => action(async () => unpack(await api.open())));
$('new').addEventListener('click', () => action(async () => unpack(await api.newDocument())));
$('save').addEventListener('click', () => action(() => save()));
$('save-as').addEventListener('click', () => { hideMenus(); action(() => save(true)); });
$('mode').addEventListener('click', toggleMode);
$('new-mindmap').addEventListener('click', () => action(async () => unpack(await api.newMindmap())));
$('skill-template').addEventListener('click', () => action(async () => unpack(await api.openTemplate())));
for (const id of ['skill-name', 'skill-description']) $(id).addEventListener('input', () => { if (loaded) markVisualChange(sessions.get(current.id)); });
$('view-switch').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) switchView(button.dataset.view); });
$('sync-scroll').addEventListener('change', event => { const state = sessions.get(current?.id); if (state) state.syncScroll = event.target.checked; });
$('more-toggle').addEventListener('click', () => toggleMenu('more-menu', $('more-toggle')));
$('block-style').addEventListener('change', event => {
  if (!editing || !visualView() || working || closing) return;
  const style = event.target.value;
  if (style === 'paragraph') editor.chain().focus().setParagraph().run();
  else editor.chain().focus().setHeading({ level: Number(style) }).run();
  updateState();
});
$('code-language').addEventListener('change', event => {
  if (!editing || !visualView() || working || closing || !editor.isActive('codeBlock')) return;
  editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value || null }).run();
  updateState();
});
document.querySelectorAll('[data-command]').forEach(button => {
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => command(button.dataset.command));
});
document.querySelectorAll('[data-table]').forEach(button => {
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => { if (!editing || !visualView() || working || closing) return; editor.chain().focus()[button.dataset.table]().run(); updateState(); });
});
function historyCommand(name) {
  hideMenus(); if (!editing || working || closing) return;
  if (isMindmap()) { sessions.get(current.id).map[name](); return; }
  if (viewMode === 'render') editor.chain().focus()[name]().run();
  else { const source = sessions.get(current.id).source; source[name](); }
}
$('undo').addEventListener('click', () => historyCommand('undo'));
$('redo').addEventListener('click', () => historyCommand('redo'));
$('theme').addEventListener('click', () => {
  hideMenus(); const dark = document.body.classList.toggle('dark');
  sessions.get(current?.id)?.map?.refreshTheme();
  $('theme-label').textContent = dark ? t('浅色外观') : t('黑色外观');
  try { localStorage.setItem('moye-dark', String(dark)); } catch {}
});
$('theme-label').textContent = document.body.classList.contains('dark') ? t('浅色外观') : t('黑色外观');
$('about').addEventListener('click', () => { hideMenus(); $('help-dialog').showModal(); });
$('settings').addEventListener('click', () => {
  if (working || closing || document.querySelector('dialog[open]')) return;
  hideMenus(); $('settings-error').hidden = true; $('language-select').value = getLocale(); $('settings-dialog').showModal();
});
$('check-updates').addEventListener('click', () => {
  if (working || closing || document.querySelector('dialog[open]')) return;
  hideMenus(); updates.open();
});
$('settings-check-updates').addEventListener('click', () => {
  if (working || closing) return;
  $('settings-dialog').close(); updates.open();
});
$('language-select').addEventListener('change', async () => {
  const select = $('language-select'); if (changingLanguage || closing) { select.value = getLocale(); return; }
  changingLanguage = true; select.disabled = true; $('settings-error').hidden = true;
  try { const result = unpack(await api.setLanguage(select.value)); setLocale(result.language); }
  catch (error) { select.value = getLocale(); $('settings-error').textContent = t('无法更改语言：{message}', { message: error.message }); $('settings-error').hidden = false; }
  finally { changingLanguage = false; select.disabled = false; }
});
$('link-confirm').addEventListener('click', () => {
  if (!editing || !visualView() || working || closing) return;
  const url = $('link-url').value.trim(); if (!safeLink(url)) { $('link-error').hidden = false; return; }
  $('link-dialog').close();
  editor.commands.setTextSelection(linkSelection);
  if (linkSelection.from === linkSelection.to) editor.chain().focus().insertContent({ type: 'text', text: $('link-text').value.trim() || url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
  else editor.chain().focus().setLink({ href: url }).run();
});
$('table-confirm').addEventListener('click', () => {
  if (!editing || !visualView() || working || closing) return;
  if (!$('table-dialog').querySelector('form').reportValidity()) return;
  const rows = Number($('table-rows').value), cols = Number($('table-cols').value);
  $('table-dialog').close(); editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
});
document.addEventListener('pointerdown', event => {
  if (viewMode === 'compare') sessions.get(current?.id)?.source.closeGroup();
  if (!event.target.closest('.dropdown,#more-toggle')) hideMenus();
});
document.addEventListener('keydown', event => { if (closing || working) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
document.addEventListener('keydown', event => {
  if (!isMindmap() || !editing || event.isComposing || document.querySelector('dialog[open]')) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !['z','y'].includes(event.key.toLowerCase())) return;
  event.preventDefault(); event.stopImmediatePropagation(); historyCommand(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
}, true);
document.addEventListener('keydown', event => {
  if (viewMode !== 'compare' || !editing || event.isComposing || document.querySelector('dialog[open]')) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) sessions.get(current.id).source.closeGroup();
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  event.preventDefault(); event.stopImmediatePropagation();
  historyCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo');
}, true);
for (const id of ['editor', 'skill-fields']) {
  $(id).addEventListener('beforeinput', event => {
    if (viewMode !== 'compare' || !editing || working || closing) return;
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); historyCommand(event.inputType === 'historyRedo' ? 'redo' : 'undo'); }
  }, true);
  $(id).addEventListener('compositionstart', () => { if (viewMode === 'compare') sessions.get(current.id).source.beginVisualComposition(); });
  $(id).addEventListener('compositionend', () => { if (viewMode === 'compare') sessions.get(current.id).source.endVisualComposition(); });
}
// Capture before editor keymaps; wheel must cancel Chromium's native page zoom.
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || document.querySelector('dialog[open]')) return;
  if (!['0', '+', '=', '-'].includes(event.key)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.key === '0') changeZoom(100); else stepZoom(event.key === '-' ? -1 : 1);
}, true);
document.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (event.deltaY) stepZoom(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
$('zoom-out').addEventListener('click', () => stepZoom(-1));
$('zoom-in').addEventListener('click', () => stepZoom(1));
$('zoom-reset').addEventListener('click', () => changeZoom(100));
document.addEventListener('keydown', event => {
  if (event.key === 'F2' && event.defaultPrevented) return;
  if (event.key === 'Escape') { hideMenus(); $('selection-toolbar').hidden = true; }
  if (event.key === 'F2' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) { event.preventDefault(); showNameDialog(); return; }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if (key === 'o') { event.preventDefault(); action(async () => unpack(await api.open())); }
  else if (key === 's') { event.preventDefault(); action(() => save(event.shiftKey)); }
  else if (key === 'n') { event.preventDefault(); action(async () => unpack(await api.newDocument())); }
  else if (key === 'e' && event.shiftKey) { event.preventDefault(); toggleMode(); }
  else if (key === 'w') { event.preventDefault(); action(async () => unpack(await api.closeTab(current.id))); }
  else if (key === 'tab') { event.preventDefault(); cycleTabs(event.shiftKey ? -1 : 1); }
});
$('document-tabs').addEventListener('keydown', event => {
  if (!event.target.matches('[role=tab]')) return;
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step) { event.preventDefault(); cycleTabs(step)?.then(() => $('document-tabs').querySelector('[aria-selected=true]')?.focus({ preventScroll: true })); }
});
$('editor').addEventListener('click', event => {
  const link = event.target.closest('a'); if (!link) return;
  event.preventDefault();
  if (!editing || event.ctrlKey) { if (safeLink(link.getAttribute('href'))) api.openLink(link.getAttribute('href')).then(unpack).catch(error => toast(error.message, true)); }
});
document.querySelector('.canvas').addEventListener('scroll', () => { updateSelection(); if (loaded) syncScroll('preview'); });
document.addEventListener('selectionchange', updateSelection);
document.addEventListener('compositionstart', () => { composing = true; }, true);
document.addEventListener('compositionend', () => { composing = false; checkpoint.schedule(); }, true);
document.addEventListener('scroll', () => { if (loaded) checkpoint.schedule(); }, true);
window.addEventListener('beforeunload', () => checkpoint.stop());
document.addEventListener('focusin', () => { if (viewMode === 'compare') sessions.get(current?.id)?.source.closeGroup(); updateSelection(); });
window.addEventListener('resize', () => { hideMenus(); updateSelection(); revealActiveTab(); });
document.addEventListener('dragover', event => { event.preventDefault(); });
document.addEventListener('drop', event => {
  event.preventDefault(); const file = event.dataTransfer.files[0];
  if (!file) return; if (!/\.(md|markdown|mdmap)$/i.test(file.name)) { toast(t('请拖入 .md、.markdown 或 .mdmap 文件')); return; }
  action(async () => unpack(await api.openDropped(file)));
});
api.onRequestContent(request => { try { api.respondContent(request.id, contentFor(request.documentId), undefined, sourceSafe(sessions.get(request.documentId))); } catch (error) { api.respondContent(request.id, null, error.message); } });
api.onRequestCloseState(id => {
  try {
    if (hasComposition()) throw new Error(isMindmap() ? t('请先完成思维导图的节点文字输入，再关闭窗口。') : t('请先完成当前文字输入，再关闭窗口。'));
    const snapshot = collectRecovery(); if (!snapshot) throw new Error(t('文档尚未载入，请稍后再关闭。'));
    closing = true; stashActive(); setInputPermissions(); updateSelection(); renderTabs();
    api.respondCloseState(id, snapshot.documents, undefined, snapshot);
  } catch (error) { api.respondCloseState(id, null, error.message); }
});
api.onClosingCanceled(() => { closing = false; setInputPermissions(); updateSelection(); renderTabs(); });
api.onDocument(loadDocument);
api.onSaved(applySaved);
api.onClosed(({ id, document }) => {
  const state = sessions.get(id); clearTimeout(state?.previewTimer); state?.editor?.destroy(); state?.source?.destroy(); state?.map?.destroy(); sessions.delete(id);
  if (current?.id === id) { current = null; editor = undefined; loaded = false; loadDocument(document); }
  else { tabOrder = document.tabs; renderTabs(); }
});
onLocaleChange(refreshLanguage);
function markDocumentReady() {
  // Record the rendered document independently of a benchmark's CDP attach
  // time. A hidden/minimized window is not counted as visibly ready.
  const recordWhenVisible = () => {
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', recordWhenVisible, { once: true });
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.visibilityState !== 'visible') { recordWhenVisible(); return; }
      if (!performance.getEntriesByName('md-document-ready', 'mark').length) performance.mark('md-document-ready');
    }));
  };
  recordWhenVisible();
}
async function initialize() {
  const settings = unpack(await api.getSettings()); setLocale(settings.language); refreshLanguage();
  const { documents = [], recoveryNotice, ...document } = unpack(await api.ready());
  for (const value of documents) sessions.set(value.id, createSession(value, value.id === document.id));
  loadDocument(document);
  if (recoveryNotice) toast(recoveryNotice, true);
  checkpoint.schedule();
  unpack(await api.sessionReady());
  markDocumentReady();
}
initialize().catch(error => toast(t('无法打开文档：{message}', { message: error.message }), true));
