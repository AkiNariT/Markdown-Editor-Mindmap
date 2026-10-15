const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'moye-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const dataArg = process.argv.find(arg => arg.startsWith('--user-data-dir='));
if (dataArg) app.setPath('userData', dataArg.slice('--user-data-dir='.length));
let win, files, helpers, imageHelpers, mindmap, mindmapFiles, mindmapCreate, recovery, recoveryStore, windowState, windowStore, openQueue, openArguments, doc, closing = false, busy = false;
let recoveryNotice = null, rendererReady = false, openingInitial = false, windowSaveTimer, lastWindowState, correctingWindow = false;
let t = message => message, getLocale = () => 'zh-CN', setLocale, settingsStore;
const pendingOpenRequests = [{ argv: process.argv, cwd: process.cwd() }];
let checkpointInProgress = false, closeAfterCheckpoint = false;
let checkpointFinished = Promise.resolve();
const documents = new Map();
const pending = new Map();
const root = path.resolve(__dirname, '..');
app.setName('MD');
if (process.platform === 'win32') app.setAppUserModelId('Moye.MD');
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const markdownPath = name => typeof name === 'string' && /\.(md|markdown)$/i.test(name);
const mindmapPath = name => typeof name === 'string' && /\.mdmap$/i.test(name);
const supportedPath = name => markdownPath(name) || mindmapPath(name);
const welcome = () => t('# 留一点空间，给文字。\n\n欢迎来到 **MD**。这里可以阅读 Markdown，也可以直接在排版后的正文里编辑。\n\n## 从一份文档开始\n\n点击左上角的「打开」，或把 `.md` 文件拖进窗口。点击「编辑」后，就能像写笔记一样输入和修改。\n\n## 格式，按需出现\n\n选中一段文字，设置 **粗体**、*斜体* 或标题。标题、列表、引用、表格和图片直接显示在正文上方的编辑栏。\n\n> 少一点界面，多一点专注。\n\n## 一切保存在本地\n\n修改后点击「保存」，文件仍然是 Markdown。关闭文档前，MD会提醒你保存尚未保存的内容。\n');

function isSkillDocument(value = doc) { return value.type !== 'mindmap' && (value.skillDocument ?? (value.path ? path.basename(value.path).toLowerCase() === 'skill.md' : value.suggestedName === 'SKILL.md')); }
function needsSave(value) { return value.dirty || (!value.path && value.namedDraft); }
function tabList() { return [...documents.values()].map(value => ({ id: value.id, type: value.type || 'markdown', path: value.path, suggestedName: value.suggestedName, dirty: Boolean(needsSave(value)) })); }
function payload(value = doc, editable = value.editable) {
  const { previewContent, draft, viewState, visualLossy, ...data } = value;
  return { ...data, recovery: { ...(draft !== undefined && (value.dirty || !value.path) ? { draft } : {}), viewState: viewState || {}, visualLossy: visualLossy === true }, skillDocument: Boolean(isSkillDocument(value)), unsupported: value.type === 'mindmap' ? [] : helpers.detectUnsupported(value.content), editable, tabs: tabList() };
}
function updateTitle() { win.setTitle((needsSave(doc) ? '• ' : '') + (doc.path ? path.basename(doc.path) : (doc.suggestedName || t('未命名'))) + ' — MD'); }
function activateDocument(id, notify = true) {
  const value = documents.get(id); if (!value) throw new Error(t('文档标签已关闭。'));
  doc = value; updateTitle();
  if (notify) win.webContents.send('moye:document', payload());
}
function setDocument(value, editable = false, notify = true) {
  if (documents.size >= 80) throw new Error(t('最多打开 80 个标签，请关闭部分标签后重试。'));
  const entry = { ...value, id: randomUUID(), imageKey: randomUUID(), dirty: false, copyOnly: false, editable };
  documents.set(entry.id, entry); activateDocument(entry.id, notify);
}
function sessionSnapshot() { return { version: 1, activeId: doc?.id ?? null, documents: [...documents.values()] }; }
async function persistSession(forgetPrevious = false, snapshot = sessionSnapshot()) {
  const saved = await recoveryStore.save(snapshot);
  // Closed tabs and explicit discards must also disappear from the fallback.
  if (forgetPrevious) await recoveryStore.save(snapshot);
  return saved;
}
async function checkpoint(value) {
  recovery.mergeCheckpoint(documents, value, { validateMap: mindmap.parseMindmap });
  if (doc) updateTitle();
  return persistSession();
}
async function restoreSession() {
  const loaded = await recoveryStore.load(), notices = [];
  if (loaded.notice) notices.push(loaded.notice);
  if (loaded.session) {
    for (const saved of loaded.session.documents) {
      try {
        let entry = { ...saved };
        if (saved.path) {
          try {
            const disk = await readOpenedDocument(saved.path);
            if (!saved.dirty) { Object.assign(entry, disk); delete entry.draft; }
            else if (disk.fingerprint !== saved.fingerprint) notices.push(t('“{name}”已在外部变化，恢复的草稿保留原校验信息，请另存为。', { name: path.basename(saved.path) }));
          } catch (error) { notices.push(t('“{name}”暂时无法从原位置读取，已保留本地缓存；修改后请另存为。', { name: path.basename(saved.path) })); }
          entry.fileKey = await fileKey(saved.path);
          if ([...documents.values()].some(value => value.fileKey === entry.fileKey)) continue;
        }
        if (entry.type === 'mindmap') {
          entry.mapData = mindmapFiles.resolveMindmapFiles(mindmap.parseMindmap(entry.content), entry.path);
          if (entry.draft !== undefined) mindmap.parseMindmap(entry.draft);
        }
        entry.imageKey = randomUUID(); entry.previewContent = entry.draft ?? entry.content;
        documents.set(entry.id, entry);
      } catch (error) { notices.push(t('一个标签的恢复记录无法读取：{error}', { error: t(error.message) })); }
    }
    if (documents.size) activateDocument(documents.has(loaded.session.activeId) ? loaded.session.activeId : documents.keys().next().value, false);
  }
  recoveryNotice = notices.length ? [...new Set(notices)].join('\n') : null;
}
function askContent(documentId) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('编辑器未响应，请稍后重试。'))); }, 15000);
    pending.set(id, { resolve, reject, timer, type: 'content' }); win.webContents.send('moye:request-content', { id, documentId });
  });
}
function askCloseState() {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('编辑器未响应，请稍后重试。'))); }, 15000);
    pending.set(id, { resolve, reject, timer, type: 'close' });
    win.webContents.send('moye:request-close-state', id);
  });
}
async function saveDocument(content, as = false, document = doc, sourceSafe = false) {
  const record = document;
  const isMindmap = record.type === 'mindmap';
  const copyOnly = !isMindmap && record.copyOnly && !sourceSafe;
  if (typeof content !== 'string') throw new Error(t('文档内容无效。'));
  if (Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw new Error(t('文档超过 8 MB，未保存修改。'));
  const incomingMap = isMindmap ? mindmap.parseMindmap(content) : null;
  const originalHeader = isMindmap ? null : helpers.splitFrontmatter(record.content);
  const incomingHeader = isMindmap ? null : helpers.splitFrontmatter(content);
  if (originalHeader && !incomingHeader && !sourceSafe && !copyOnly) throw new Error(t('文件头信息未能完整保留，未保存修改。'));
  if (isSkillDocument(record) && (originalHeader?.skill || incomingHeader?.skill)) {
    if (!incomingHeader?.skill) throw new Error(t('技能名称与用途信息无效，未保存修改。'));
    helpers.validateSkillFields(incomingHeader.skill);
  }
  let target = record.path;
  if (as || !target || copyOnly) {
    const extension = isMindmap ? '.mdmap' : '.md';
    const suggestion = record.path ? path.join(path.dirname(record.path), path.basename(record.path, path.extname(record.path)) + (copyOnly ? t('-编辑副本') : t('-副本')) + extension) : (record.suggestedName || t('未命名') + extension);
    const result = await dialog.showSaveDialog(win, { title: isMindmap ? t('保存思维导图') : copyOnly ? t('另存编辑副本') : t('保存 Markdown'), defaultPath: suggestion, filters: [isMindmap ? { name: t('MD 思维导图'), extensions: ['mdmap'] } : { name: t('Markdown 文档'), extensions: ['md', 'markdown'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath; if (!(isMindmap ? mindmapPath(target) : markdownPath(target))) target += extension;
  }
  const targetKey = await fileKey(target);
  const other = [...documents.values()].find(value => value.id !== record.id && value.fileKey === targetKey);
  if (other) throw new Error(t('这个文件已在另一个标签中打开，请选择其他文件名。'));
  if (copyOnly && targetKey === record.fileKey) throw new Error(t('这份文件含未支持的格式，请选择另一个文件名保存副本。'));
  let expected = record.fingerprint;
  const samePath = record.path && targetKey === record.fileKey;
  if (!samePath) {
    try { expected = (await files.readDocument(target)).fingerprint; } catch (error) { if (error.code === 'ENOENT') expected = null; else throw error; }
    if (record.path && !isMindmap) {
      const header = helpers.splitFrontmatter(content);
      const rebased = imageHelpers.rebaseImages(header ? header.body : content, path.dirname(record.path), path.dirname(target));
      content = header ? header.prefix + rebased : rebased;
    }
  }
  if (isMindmap) {
    content = mindmapFiles.serializeMindmapForPath(incomingMap, target);
    if (!record.dirty && samePath && mindmap.serializeMindmap(incomingMap) === mindmap.serializeMindmap(record.mapData)) return { ...payload(record), unchanged: true };
  }
  if (!record.dirty && samePath && content === record.content) return { ...payload(record), unchanged: true };
  const saved = await files.writeDocument(target, content, expected);
  const skillDocument = Boolean(isSkillDocument(record));
  Object.assign(record, saved, { fileKey: await fileKey(saved.path), skillDocument, imageKey: samePath ? record.imageKey : randomUUID(), inserted: samePath ? record.inserted : undefined, dirty: false, namedDraft: false, previewContent: saved.content, copyOnly: !isMindmap && !sourceSafe && helpers.detectUnsupported(saved.content).length > 0 });
  record.draft = saved.content; record.visualLossy = false;
  if (isMindmap) record.mapData = mindmapFiles.resolveMindmapFiles(mindmap.parseMindmap(saved.content), saved.path);
  if (record === doc) updateTitle();
  await persistSession();
  return payload(record);
}
async function guardUnsaved(document = doc, discarded) {
  if (!needsSave(document)) return true;
  const name = document.path ? path.basename(document.path) : (document.suggestedName || t('未命名'));
  const choice = await dialog.showMessageBox(win, { type: 'question', title: t('保存修改'), message: t('“{name}”还有尚未保存的修改。', { name }), buttons: [t('保存'), t('放弃修改'), t('取消')], defaultId: 0, cancelId: 2, noLink: true });
  if (choice.response === 2) return false;
  if (choice.response === 0) {
    const response = await askContent(document.id);
    const saved = await saveDocument(response.content, false, document, response.sourceSafe);
    if (saved.canceled) return false;
    win.webContents.send('moye:saved', saved);
    return true;
  }
  discarded?.add(document.id);
  return true;
}
async function fileKey(target) {
  try { return (await fs.realpath(target)).toLowerCase(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { return path.join(await fs.realpath(path.dirname(target)), path.basename(target)).toLowerCase(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return path.resolve(target).toLowerCase(); }
}
async function renameDocument(id, requestedName) {
  const record = documents.get(id); if (!record) throw new Error(t('文档标签已关闭。'));
  const extension = record.type === 'mindmap' ? 'mdmap' : 'md';
  const name = files.normalizeDocumentName(requestedName, extension);
  const renamedFrom = record.path;
  const skillDocument = record.type !== 'mindmap' && Boolean(isSkillDocument(record) || name.toLowerCase() === 'skill.md');
  if (record.path) {
    const target = path.join(path.dirname(record.path), name), key = await fileKey(target);
    if ([...documents.values()].some(value => value.id !== id && value.fileKey === key)) throw new Error(t('这个文件名已在另一个标签打开，请选择其他名称。'));
    const renamed = await files.renameDocument(record.path, name, record.fingerprint, extension);
    Object.assign(record, { path: renamed, fileKey: await fileKey(renamed), skillDocument });
  } else Object.assign(record, { suggestedName: name, namedDraft: true, skillDocument });
  if (record === doc) updateTitle();
  await persistSession();
  return { ...payload(record), renamedFrom };
}
async function readOpenedDocument(target) {
  const value = await files.readDocument(path.resolve(target));
  if (mindmapPath(target)) return { ...value, type: 'mindmap', mapData: mindmapFiles.resolveMindmapFiles(mindmap.parseMindmap(value.content), value.path) };
  return value;
}
async function openDocument(target, notify = true, editable = false) {
  let targets = target ? [target] : [];
  if (!target) {
    const choice = await dialog.showOpenDialog(win, { title: t('打开文档'), properties: ['openFile', 'multiSelections'], filters: [{ name: t('Markdown 与思维导图'), extensions: ['md', 'markdown', 'mdmap'] }] });
    if (choice.canceled || !choice.filePaths.length) return { canceled: true }; targets = choice.filePaths;
  }
  for (const target of targets) {
    if (!supportedPath(target)) throw new Error(t('请打开 .md、.markdown 或 .mdmap 文件。'));
    const key = await fileKey(target);
    const existing = [...documents.values()].find(value => value.fileKey === key);
    if (existing) activateDocument(existing.id, notify);
    else setDocument({ ...await readOpenedDocument(target), fileKey: key }, editable, notify);
    await persistSession();
  }
  return { ok: true };
}
async function closeDocument(id) {
  const entry = documents.get(id); if (!entry) return { canceled: true };
  if (!await guardUnsaved(entry)) return { canceled: true };
  const ids = [...documents.keys()], index = ids.indexOf(id), active = doc === entry;
  documents.delete(id);
  if (!documents.size) setDocument({ path: null, content: '', fingerprint: null }, true, false);
  else if (active) activateDocument(ids[index + 1] || ids[index - 1], false);
  await persistSession(true);
  win.webContents.send('moye:closed', { id, document: payload() });
  return { ok: true };
}
async function imageRequest(request) {
  try {
    const url = new URL(request.url);
    const record = [...documents.values()].find(value => value.imageKey === url.hostname);
    if (!record?.path || record.type === 'mindmap') return new Response('', { status: 403 });
    const source = decodeURIComponent(url.pathname.slice(1));
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//')) return new Response('', { status: 403 });
    const resolved = path.resolve(path.dirname(record.path), decodeURIComponent(source));
    const real = await fs.realpath(resolved);
    const ext = path.extname(real).toLowerCase();
    if (!imageTypes[ext]) return new Response('', { status: 415 });
    const info = await fs.stat(real); if (!info.isFile() || info.size > 20 * 1024 * 1024) return new Response('', { status: 413 });
    // Request is restricted to image refs actually present in this document.
    const { marked } = await import('marked'); let allowed = false;
    const visible = record.previewContent ?? record.content;
    marked.walkTokens(marked.lexer(helpers.splitFrontmatter(visible)?.body ?? visible), token => { if (token.type === 'image' && token.href === source) allowed = true; });
    if (!allowed && !record.inserted?.has(source)) return new Response('', { status: 403 });
    return new Response(await fs.readFile(real), { headers: { 'content-type': imageTypes[ext], 'cache-control': 'no-store' } });
  } catch { return new Response('', { status: 404 }); }
}
function authorized(event) { return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function drainOpenQueue() { if (openQueue) void openQueue.drain().catch(error => console.error(t('打开队列失败'), error)); }
function resolveWindowPlacement(value) { return windowState.resolveWindowState(value, screen.getAllDisplays(), screen.getPrimaryDisplay().id); }
function applyWindowBounds(bounds) {
  let requested = { ...bounds };
  // Windows can round frame insets twice at fractional DPI during construction.
  // Compare actual DIP bounds, then compensate the request instead of repeatedly
  // saving the inflated result and growing the window on every restart.
  for (let attempt = 0; attempt < 4; attempt++) {
    // At a tiny work-area boundary the corrected request can be below the
    // nominal minimum by a few DIP. Let native sizing reach the intended outer
    // bounds instead of clamping that request and leaving the window offscreen.
    const [minWidth, minHeight] = win.getMinimumSize();
    if (requested.width < minWidth || requested.height < minHeight) win.setMinimumSize(Math.min(minWidth, requested.width), Math.min(minHeight, requested.height));
    win.setBounds(requested);
    const actual = win.getNormalBounds();
    if (['x', 'y', 'width', 'height'].every(key => actual[key] === bounds[key])) break;
    requested = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, requested[key] + bounds[key] - actual[key]]));
    requested.width = Math.max(1, requested.width); requested.height = Math.max(1, requested.height);
  }
}
function captureWindowPlacement() {
  if (win && !win.isDestroyed() && !win.isMinimized()) lastWindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  return lastWindowState;
}
async function saveWindowPlacement() {
  clearTimeout(windowSaveTimer);
  try { const value = captureWindowPlacement(); if (value && windowStore) await windowStore.save(value); }
  catch (error) { console.error(t('窗口位置保存失败'), error.message); }
}
function scheduleWindowPlacement() {
  if (correctingWindow || !win || win.isDestroyed()) return;
  captureWindowPlacement(); clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => { void saveWindowPlacement(); }, 180);
}
function correctWindowPlacement() {
  if (!win || win.isDestroyed() || correctingWindow) return;
  try {
    const previous = captureWindowPlacement(), next = resolveWindowPlacement(previous);
    if (win.isMinimized()) { lastWindowState = { bounds: next.bounds, maximized: previous.maximized }; return; }
    correctingWindow = true;
    win.setMinimumSize(next.minWidth, next.minHeight);
    const current = win.getNormalBounds();
    if (['x', 'y', 'width', 'height'].some(key => current[key] !== next.bounds[key])) {
      const maximized = win.isMaximized();
      if (maximized) win.unmaximize();
      applyWindowBounds(next.bounds);
      if (maximized) win.maximize();
    }
  } catch (error) { console.error(t('窗口可见区域校正失败'), error.message); }
  finally { correctingWindow = false; scheduleWindowPlacement(); }
}
function handle(name, callback) {
  ipcMain.handle('moye:' + name, async (event, ...args) => {
    if (!authorized(event)) return { error: t('操作来源无效。') };
    const serialized = !['get-settings', 'ready', 'session-ready', 'link', 'preview'].includes(name);
    if (serialized && name !== 'checkpoint' && checkpointInProgress) await checkpointFinished;
    if (busy && serialized) return { error: t('正在处理文档，请稍后重试。') };
    if (serialized) busy = true;
    let finishCheckpoint;
    if (name === 'checkpoint') {
      checkpointInProgress = true;
      checkpointFinished = new Promise(resolve => { finishCheckpoint = resolve; });
    }
    try { return await callback(...args); } catch (error) { return { error: t(error.message) }; } finally {
      if (serialized) busy = false;
      if (name === 'checkpoint') {
        checkpointInProgress = false;
        if (closeAfterCheckpoint) {
          closeAfterCheckpoint = false;
          queueMicrotask(() => { if (win && !win.isDestroyed()) win.close(); });
        }
        finishCheckpoint();
      }
      drainOpenQueue();
    }
  });
}
// Electron's lock is scoped to userData, so isolated profiles remain independent.
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on('second-instance', (_event, argv, cwd) => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  if (openQueue) openQueue.enqueue(openArguments(argv, cwd));
  else pendingOpenRequests.push({ argv, cwd });
});
if (ownsProfile) app.whenReady().then(async () => {
  ({ t, getLocale, setLocale } = await import(pathToFileURL(path.join(root, 'src/i18n.mjs')).href));
  const settings = await import(pathToFileURL(path.join(root, 'src/settings.mjs')).href);
  settingsStore = settings.createSettingsStore(app.getPath('userData'));
  setLocale((await settingsStore.load()).language);
  files = await import(pathToFileURL(path.join(root, 'src/files.mjs')).href);
  helpers = await import(pathToFileURL(path.join(root, 'src/document.mjs')).href);
  imageHelpers = await import(pathToFileURL(path.join(root, 'src/images.mjs')).href);
  mindmap = await import(pathToFileURL(path.join(root, 'src/mindmap.mjs')).href);
  mindmapFiles = await import(pathToFileURL(path.join(root, 'src/mindmap-files.mjs')).href);
  mindmapCreate = await import(pathToFileURL(path.join(root, 'src/mindmap-create.mjs')).href);
  recovery = await import(pathToFileURL(path.join(root, 'src/recovery.mjs')).href);
  windowState = await import(pathToFileURL(path.join(root, 'src/window-state.mjs')).href);
  const queueModule = await import(pathToFileURL(path.join(root, 'src/open-queue.mjs')).href);
  openArguments = queueModule.parseOpenArguments;
  recoveryStore = recovery.createRecoveryStore(app.getPath('userData'));
  windowStore = windowState.createWindowStateStore(app.getPath('userData'));
  const placement = resolveWindowPlacement(await windowStore.load());
  lastWindowState = { bounds: placement.bounds, maximized: placement.maximized };
  protocol.handle('moye-image', imageRequest);
  win = new BrowserWindow({ ...placement.bounds, minWidth: placement.minWidth, minHeight: placement.minHeight, show: false, title: 'MD', icon: path.join(root, 'assets/icon.ico'), backgroundColor: '#f8f7f4', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }, });
  applyWindowBounds(placement.bounds);
  Menu.setApplicationMenu(null);
  await restoreSession();
  openQueue = queueModule.createOpenQueue({
    canRun: () => (openingInitial || rendererReady) && !busy && !closing && win && !win.isDestroyed(),
    open: async target => { busy = true; try { await openDocument(target, rendererReady); } finally { busy = false; } },
    onError: error => dialog.showErrorBox(t('打开失败'), t(error.message)),
  });
  for (const request of pendingOpenRequests.splice(0)) openQueue.enqueue(openArguments(request.argv, request.cwd));
  openingInitial = true; await openQueue.drain(); openingInitial = false;
  if (!documents.size) setDocument({ path: null, content: welcome(), fingerprint: null }, false, false);
  handle('get-settings', () => ({ language: getLocale() }));
  handle('set-language', async language => {
    const saved = await settingsStore.setLanguage(language);
    setLocale(saved.language);
    if (doc) updateTitle();
    return saved;
  });
  handle('ready', () => ({ ...payload(), documents: [...documents.values()].map(value => payload(value)), recoveryNotice }));
  handle('session-ready', () => { rendererReady = true; return { ok: true }; });
  handle('checkpoint', checkpoint);
  handle('open', () => openDocument()); handle('drop', name => openDocument(name));
  handle('activate', async id => { activateDocument(id); await persistSession(); return { ok: true }; });
  handle('close-tab', closeDocument);
  handle('template', async () => {
    const template = await files.readDocument(path.join(root, getLocale() === 'en' ? 'assets/templates/SKILL.en.md' : 'assets/templates/SKILL.md'));
    setDocument({ path: null, content: template.content, fingerprint: null, suggestedName: 'SKILL.md', skillDocument: true }, true);
    await persistSession();
    return { ok: true };
  });
  handle('new', async () => { setDocument({ path: null, content: '', fingerprint: null }, true); await persistSession(); return { ok: true }; });
  handle('new-mindmap', async () => {
    const mapData = mindmap.createMindmap();
    setDocument({ type: 'mindmap', path: null, content: mindmap.serializeMindmap(mapData), mapData, fingerprint: null, suggestedName: t('未命名导图.mdmap'), namedDraft: true }, true);
    await persistSession();
    return { ok: true };
  });
  handle('mindmap-choose-file', async () => {
    const result = await dialog.showOpenDialog(win, { title: t('关联 Markdown 文件'), properties: ['openFile'], filters: [{ name: t('Markdown 文档'), extensions: ['md', 'markdown'] }] });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const target = result.filePaths[0];
    if (!markdownPath(target)) throw new Error(t('请选择 .md 或 .markdown 文件。'));
    await files.readDocument(target);
    return { path: path.resolve(target) };
  });
  handle('mindmap-create-file', async (id, content, nodeId) => {
    const record = documents.get(id);
    if (record?.type !== 'mindmap') throw new Error(t('这个思维导图标签已关闭。'));
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw new Error(t('思维导图内容无效或超过 8 MB。'));
    const mapData = mindmapFiles.resolveMindmapFiles(mindmap.parseMindmap(content), record.path);
    const node = mapData.nodes.find(value => value.id === nodeId);
    if (!node) throw new Error(t('这个节点已不存在。'));
    if (node.file) throw new Error(t('这个节点已关联文件，请先解除关联。'));
    const directory = record.path ? path.dirname(record.path) : app.getPath('documents');
    const result = await dialog.showSaveDialog(win, { title: t('创建 Markdown 文件'), buttonLabel: t('创建并关联'), defaultPath: path.join(directory, mindmapCreate.suggestNodeFileName(node.text)), filters: [{ name: t('Markdown 文档'), extensions: ['md', 'markdown'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const target = markdownPath(result.filePath) ? result.filePath : result.filePath + '.md';
    return mindmapCreate.createNodeMarkdown(target, node.text);
  });
  handle('mindmap-open-file', async (id, content, nodeId, created = false) => {
    const record = documents.get(id);
    if (record?.type !== 'mindmap') throw new Error(t('这个思维导图标签已关闭。'));
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw new Error(t('思维导图内容无效或超过 8 MB。'));
    const mapData = mindmapFiles.resolveMindmapFiles(mindmap.parseMindmap(content), record.path);
    const node = mapData.nodes.find(value => value.id === nodeId);
    if (!node) throw new Error(t('这个节点已不存在。'));
    if (!node.file) throw new Error(t('请先为这个节点关联 Markdown 文件。'));
    try { await files.readDocument(node.file); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error(t('关联的 Markdown 文件已移动或删除，请重新关联文件。')); throw error; }
    return openDocument(node.file, true, created === true);
  });
  handle('rename', renameDocument);
  handle('save', (content, as, sourceSafe) => saveDocument(content, as, doc, sourceSafe === true));
  handle('preview', (id, content) => {
    const record = documents.get(id);
    if (!record || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 8 * 1024 * 1024) throw new Error(t('预览内容无效或超过 8 MB。'));
    record.previewContent = content; return { ok: true };
  });
  handle('edit', async (sourceMode = false) => {
    const unsupported = doc.type === 'mindmap' ? [] : helpers.detectUnsupported(doc.content);
    if (unsupported.length && doc.path && !sourceMode) {
      const result = await dialog.showMessageBox(win, { type: 'warning', title: t('编辑副本'), message: t('这份文档包含：{formats}', { formats: unsupported.join(getLocale() === 'en' ? ', ' : '、') }), detail: t('首版不能完整编辑这些格式。继续后可修改显示出来的正文，保存时必须另存副本；原文件会保留。'), buttons: [t('编辑副本'), t('取消')], defaultId: 1, cancelId: 1, noLink: true });
      if (result.response !== 0) return { canceled: true }; doc.copyOnly = true;
    }
    doc.editable = true;
    await persistSession();
    return { ok: true, copyOnly: doc.copyOnly };
  });
  handle('link', async value => { if (!helpers.safeLink(value)) return { error: t('只支持网页或邮件链接。') }; await shell.openExternal(value); return { ok: true }; });
  handle('image', async () => {
    if (doc.type === 'mindmap') return { error: t('请在 Markdown 文档中插入图片。') };
    if (!doc.path) return { error: t('插入图片前，请先保存文档。') };
    const result = await dialog.showOpenDialog(win, { title: t('插入本地图片'), properties: ['openFile'], filters: [{ name: t('图片'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    if (result.canceled) return { canceled: true };
    const source = result.filePaths[0], ext = path.extname(source).toLowerCase();
    if (!imageTypes[ext] || (await fs.stat(source)).size > 20 * 1024 * 1024) throw new Error(t('请选择 20 MB 以内的 PNG、JPEG、GIF 或 WebP 图片。'));
    const directory = path.basename(doc.path, path.extname(doc.path)) + '.assets';
    const destination = path.join(path.dirname(doc.path), directory); await fs.mkdir(destination, { recursive: true });
    const filename = randomUUID().slice(0, 12) + ext; await fs.copyFile(source, path.join(destination, filename));
    const src = encodeURIComponent(directory) + '/' + filename; doc.inserted ??= new Set(); doc.inserted.add(src);
    return { src, alt: path.basename(source, ext), imageKey: doc.imageKey };
  });
  ipcMain.on('moye:dirty', (event, id, value, visualLossy = false) => {
    const record = documents.get(id);
    if (authorized(event) && record) { record.dirty = Boolean(value); if (visualLossy === true && record.type !== 'mindmap') record.copyOnly = true; if (record === doc) updateTitle(); }
  });
  ipcMain.on('moye:content', (event, value) => {
    if (!authorized(event) || (typeof value?.content !== 'string' && typeof value?.error !== 'string')) return;
    const waiter = pending.get(value.id); if (!waiter || waiter.type !== 'content') return;
    clearTimeout(waiter.timer); pending.delete(value.id);
    if (typeof value.error === 'string') waiter.reject(new Error(value.error)); else waiter.resolve({ content: value.content, sourceSafe: value.sourceSafe === true });
  });
  ipcMain.on('moye:close-state', (event, value) => {
    if (!authorized(event)) return;
    const waiter = pending.get(value?.id); if (!waiter || waiter.type !== 'close') return;
    clearTimeout(waiter.timer); pending.delete(value.id);
    if (typeof value.error === 'string') { waiter.reject(new Error(value.error)); return; }
    const states = value.documents;
    if (!Array.isArray(states) || states.length !== documents.size || new Set(states.map(state => state?.id)).size !== documents.size || states.some(state => typeof state?.dirty !== 'boolean' || !documents.has(state.id))) {
      waiter.reject(new Error(t('文档状态未能完整确认，请稍后重试。'))); return;
    }
    try {
      // Older renderers provided dirty flags only; keep their close protocol
      // working while accepting the complete lossless snapshot from this build.
      const complete = states.filter(state => typeof state.draft === 'string');
      recovery.mergeCheckpoint(documents, { documents: complete }, { validateMap: mindmap.parseMindmap });
      for (const state of states) documents.get(state.id).dirty = state.dirty;
      if (documents.has(value.activeId)) doc = documents.get(value.activeId);
      persistSession().then(waiter.resolve, waiter.reject);
    } catch (error) { waiter.reject(error); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  for (const event of ['move', 'resize', 'maximize', 'unmaximize']) win.on(event, scheduleWindowPlacement);
  win.on('restore', correctWindowPlacement);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, correctWindowPlacement);
  win.on('closed', () => {
    clearTimeout(windowSaveTimer);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, correctWindowPlacement);
  });
  win.on('close', event => {
    if (closing) return;
    if (busy) { event.preventDefault(); if (checkpointInProgress) closeAfterCheckpoint = true; return; }
    event.preventDefault(); busy = true;
    (async () => {
      await askCloseState();
      const discarded = new Set();
      for (const value of documents.values()) if (!await guardUnsaved(value, discarded)) return false;
      await persistSession(discarded.size > 0, recovery.sessionAfterDiscard(sessionSnapshot(), discarded));
      await saveWindowPlacement();
      return true;
    })()
      .then(ok => { if (ok) { closing = true; win.close(); } }).catch(error => dialog.showErrorBox(t('保存失败'), t(error.message))).finally(() => {
        busy = false; if (!win.isDestroyed()) { win.webContents.send('moye:closing-canceled'); drainOpenQueue(); }
      });
  });
  await win.loadFile(path.join(root, 'index.html'));
  if (placement.maximized) win.maximize();
  win.show(); scheduleWindowPlacement();
}).catch(error => { console.error(t('MD启动失败'), error); dialog.showErrorBox(t('MD启动失败'), t(error.message)); app.quit(); });
app.on('window-all-closed', () => app.quit());
