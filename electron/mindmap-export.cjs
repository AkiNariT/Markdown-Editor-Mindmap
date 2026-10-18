const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

function safeName(value) {
  const clean = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 64);
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? 'MD' : clean;
}

function exportFilePaths(selected, format, pages) {
  const extension = '.' + format;
  const base = selected.toLowerCase().endsWith(extension) ? selected.slice(0, -extension.length) : selected;
  if (format === 'pdf' || pages.length === 1) return [base + extension];
  const directory = path.dirname(base), name = safeName(path.basename(base));
  return pages.map((page, index) => path.join(directory, `${name}-${String(index + 1).padStart(2, '0')}-${safeName(page.title)}${extension}`));
}

function rasterDimensions(width, height) {
  const scale = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

async function snapshot(filePath) {
  try {
    const info = await fs.lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('EXPORT_TARGET_NOT_FILE');
    return { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function deadline(promise, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 45000); })]); }
  finally { clearTimeout(timer); }
}

function pageHtml(pages, dimensions, pdf = false) {
  const pageRules = pdf ? dimensions.map((size, index) => `@page export${index}{size:${size.width}px ${size.height}px;margin:0}`).join('') : '';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;background:white}*{box-sizing:border-box}img{display:block;width:100%;height:100%}.page{overflow:hidden;break-after:page;break-inside:avoid}.page:last-child{break-after:auto}${pageRules}</style></head><body>${pages.map((page, index) => `<section class="page" style="page:export${index};width:${dimensions[index].width}px;height:${dimensions[index].height}px"><img alt="" src="data:image/svg+xml;base64,${Buffer.from(page.svg).toString('base64')}"></section>`).join('')}</body></html>`;
}

async function renderBuffers(pages, format, BrowserWindow, t, preset) {
  if (format === 'svg') return pages.map(page => Buffer.from(page.svg, 'utf8'));
  const renderWindow = new BrowserWindow({
    width: 800, height: 600, show: false, backgroundColor: '#ffffff', skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true, partition: `mindmap-export-${randomUUID()}` },
  });
  const webContents = renderWindow.webContents;
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', event => event.preventDefault());
  webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
  const load = async html => {
    await deadline(webContents.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64')), t('导出渲染超时，请减少节点后重试。'));
    await deadline(webContents.executeJavaScript(`Promise.all(Array.from(document.images, image => image.decode())).then(() => document.fonts.ready).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`), t('导出渲染超时，请减少节点后重试。'));
  };
  try {
    if (format === 'pdf') {
      // Keep very large natural canvases within Chromium's PDF paper limits.
      const dimensions = pages.map(page => { const scale = Math.min(1, 12000 / page.width, 12000 / page.height); return { width: page.width * scale, height: page.height * scale }; });
      await load(pageHtml(pages, dimensions, true));
      return [await deadline(webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, margins: { top: 0, right: 0, bottom: 0, left: 0 }, pageSize: { width: dimensions[0].width / 96, height: dimensions[0].height / 96 } }), t('导出渲染超时，请减少节点后重试。'))];
    }
    const buffers = []; let bytes = 0;
    for (const page of pages) {
      const printScale = preset === 'a4-landscape' ? 300 / 96 : 1;
      const size = rasterDimensions(Math.round(page.width * printScale), Math.round(page.height * printScale));
      renderWindow.setContentSize(size.width, size.height);
      await load(pageHtml([page], [size]));
      const image = await deadline(webContents.capturePage({ x: 0, y: 0, ...size }, { stayHidden: true, stayAwake: true }), t('导出渲染超时，请减少节点后重试。'));
      const buffer = image.toPNG();
      if (!buffer.length) throw new Error(t('未能生成导出图片，请重试。'));
      bytes += buffer.length;
      if (bytes > 128 * 1024 * 1024) throw new Error(t('导出内容过大，请分章导出或减少节点。'));
      buffers.push(buffer);
    }
    return buffers;
  } finally { if (!renderWindow.isDestroyed()) renderWindow.destroy(); }
}

async function exportMindmap(parentWindow, mapData, options = {}, dependencies = {}) {
  const [{ buildMindmapExportPages }, { t }] = await Promise.all(['mindmap-export.mjs', 'i18n.mjs'].map(name => import(pathToFileURL(path.join(__dirname, '../src', name)).href)));
  if (!['svg', 'png', 'pdf'].includes(options.format)) throw new Error(t('导出格式无效。'));
  const result = buildMindmapExportPages(mapData, options), format = options.format;
  const dialog = dependencies.dialog || require('electron').dialog;
  const show = (method, value) => parentWindow ? dialog[method](parentWindow, value) : dialog[method](value);
  const selected = await show('showSaveDialog', { title: t('导出思维导图'), defaultPath: options.defaultPath || safeName(result.pages[0].title) + '.' + format, filters: [{ name: format.toUpperCase(), extensions: [format] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (selected.canceled || !selected.filePath) return { canceled: true };
  if (!path.isAbsolute(selected.filePath)) throw new Error(t('请选择完整的导出文件路径。'));
  const paths = exportFilePaths(selected.filePath, format, result.pages);
  let previous;
  try { previous = await Promise.all(paths.map(snapshot)); }
  catch (error) { if (error.message === 'EXPORT_TARGET_NOT_FILE') throw new Error(t('导出位置不是普通文件，请更换保存位置。')); throw error; }
  const existing = paths.filter((_, index) => previous[index] !== null);
  if (existing.length) {
    const answer = await show('showMessageBox', { type: 'warning', title: t('替换导出文件'), message: t('以下导出文件已存在，是否替换？'), detail: existing.join('\n'), buttons: [t('替换'), t('取消')], defaultId: 1, cancelId: 1, noLink: true });
    if (answer.response !== 0) return { canceled: true };
  }
  const buffers = await renderBuffers(result.pages, format, dependencies.BrowserWindow || (format !== 'svg' ? require('electron').BrowserWindow : null), t, result.preset);
  const staged = [];
  try {
    for (const [index, target] of paths.entries()) {
      const temporary = path.join(path.dirname(target), `.md-export-${randomUUID()}.tmp`);
      await fs.writeFile(temporary, buffers[index], { flag: 'wx' }); staged.push(temporary);
    }
    for (const [index, target] of paths.entries()) {
      if (JSON.stringify(await snapshot(target)) !== JSON.stringify(previous[index])) throw new Error(t('导出目标已被其他程序更改，请重新导出。'));
    }
    for (const [index, target] of paths.entries()) {
      if (previous[index] === null) {
        // Exclusive creation preserves a file that appears after confirmation.
        try { await fs.link(staged[index], target); }
        catch (error) {
          if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
          await fs.copyFile(staged[index], target, constants.COPYFILE_EXCL);
        }
      } else await fs.rename(staged[index], target);
    }
  } finally { await Promise.all(staged.map(file => fs.rm(file, { force: true }).catch(() => {}))); }
  return { canceled: false, paths, count: paths.length, pageCount: result.pages.length };
}

module.exports = { exportMindmap, exportFilePaths, rasterDimensions };
