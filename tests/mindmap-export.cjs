const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir, mkdtemp, writeFile, readFile } = require('node:fs/promises');

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'mindmap-export-'));
  const bootstrap = path.join(directory, 'main.cjs');
  await writeFile(bootstrap, "globalThis.testRequire = require; const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { globalThis.keeper = new BrowserWindow({ show: false, webPreferences: { sandbox: true } }); keeper.loadURL('data:text/html,Export-test'); });");
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, '--user-data-dir=' + path.join(directory, 'profile')], env, timeout: 30000 });
  try {
    const node = (id, parent, text, extra = {}) => ({ id, parent, text, file: null, collapsed: false, ...extra });
    const map = { format: 'md-mindmap', version: 6, root: 'root', theme: 'crystal', lineStyle: 'orthogonal', nodeSize: 'wide', nodes: [node('root', null, '教学知识图谱 <安全文字>'), node('a', 'root', '第一章：世界局势', { background: '#dbeafe', color: '#1e3a5f', subtitle: '时代条件 → 自身回应' }), node('b', 'root', '第二章：实践方法', { background: '#dcf0df', color: '#244b35' }), node('a1', 'a', '百年未有之大变局：国际体系与全球治理深刻调整'), node('b1', 'b', '坚持系统观念，统筹发展与安全')], connections: [{ id: 'relation', from: 'a1', to: 'b1', label: '理论联系实践', style: 'solid', arrow: 'both', color: '#724523' }] };
    const results = {};
    for (const format of ['svg', 'png', 'pdf']) {
      results[format] = await app.evaluate(async ({ BrowserWindow, dialog }, { helper, map, directory, format }) => {
        const path = globalThis.testRequire('node:path');
        const before = BrowserWindow.getAllWindows().length;
        const { exportMindmap } = globalThis.testRequire(helper);
        const result = await exportMindmap(null, map, { format, preset: '16:10', scope: 'chapters' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, '讲义.' + format) }) }, BrowserWindow });
        return { result, before, after: BrowserWindow.getAllWindows().length };
      }, { helper: path.resolve(__dirname, '../electron/mindmap-export.cjs'), map, directory, format });
      assert.equal(results[format].before, results[format].after, 'hidden export window must be destroyed');
      assert.equal(results[format].result.pageCount, 3);
      assert.equal(results[format].result.count, format === 'pdf' ? 1 : 3);
      assert.equal(results[format].result.paths.length, format === 'pdf' ? 1 : 3);
    }
    for (const file of results.svg.result.paths) { const contents = await readFile(file, 'utf8'); assert.ok(contents.startsWith('<svg')); assert.ok(!contents.includes('<foreignObject')); }
    const png = await readFile(results.png.result.paths[0]);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1200);
    const pixels = await app.evaluate(({ nativeImage }, file) => {
      const image = nativeImage.createFromPath(file), bitmap = image.toBitmap(); let colorful = 0, dark = 0;
      for (let i = 0; i < bitmap.length; i += 4) { if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) - Math.min(bitmap[i], bitmap[i + 1], bitmap[i + 2]) > 20) colorful++; if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) < 100) dark++; }
      return { colorful, dark };
    }, results.png.result.paths[0]);
    assert.ok(pixels.colorful > 10000 && pixels.dark > 100, 'PNG must contain colored nodes and readable text');
    const pdf = await readFile(results.pdf.result.paths[0]);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const pdfText = pdf.toString('latin1');
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 3, 'overview plus two chapter pages');
    assert.ok(pdfText.includes('/ToUnicode'), 'PDF includes searchable vector text');
    const a4 = await app.evaluate(async ({ BrowserWindow }, { helper, map, directory }) => {
      const { exportMindmap } = globalThis.testRequire(helper), path = globalThis.testRequire('node:path');
      return exportMindmap(null, map, { format: 'png', preset: 'a4-landscape' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, 'A4.png') }) }, BrowserWindow });
    }, { helper: path.resolve(__dirname, '../electron/mindmap-export.cjs'), map, directory });
    const a4Png = await readFile(a4.paths[0]);
    assert.equal(a4Png.readUInt32BE(16), 3508); assert.equal(a4Png.readUInt32BE(20), 2480);
    const longTitleMap = { ...map, nodeSize: 'compact', connections: [], nodes: [node('root', null, '长标题完整显示'.repeat(60), { subtitle: '副标题也位于背景中'.repeat(10) })] };
    const longCard = await app.evaluate(async ({ BrowserWindow }, { helper, map, directory }) => {
      const { exportMindmap } = globalThis.testRequire(helper), path = globalThis.testRequire('node:path');
      return exportMindmap(null, map, { format: 'png', preset: 'natural' }, { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, 'long-card.png') }) }, BrowserWindow });
    }, { helper: path.resolve(__dirname, '../electron/mindmap-export.cjs'), map: longTitleMap, directory });
    assert.equal(longCard.count, 1);
    await writeFile(path.join(directory, 'results.json'), JSON.stringify({ directory, results, pixels }, null, 2));
    console.log(JSON.stringify({ passed: true, directory, png: results.png.result.paths[0], pdf: results.pdf.result.paths[0], pages: 3, pixels, a4Png: a4.paths[0], longCard: longCard.paths[0] }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
