import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildMindmapExportPages } from '../src/mindmap-export.mjs';
import { layoutMindmap } from '../src/mindmap-layout.mjs';
import { createMindmapRouter } from '../src/mindmap-routing.mjs';

const node = (id, parent, text = id, extra = {}) => ({ id, parent, text, file: null, collapsed: false, ...extra });
const map = (nodes, extra = {}) => ({ format: 'md-mindmap', version: 6, root: 'root', nodes, connections: [], ...extra });
const xml = page => new JSDOM(page.svg, { contentType: 'image/svg+xml' }).window.document;

test('vector export escapes user text and never loads linked Markdown or embeds active markup', () => {
  const page = buildMindmapExportPages(map([node('root', null, '<script>& "中文"', { file: 'C:/private/secret.md', subtitle: '<image href="https://bad.invalid"/>' })])).pages[0];
  const doc = xml(page);
  assert.match(doc.documentElement.textContent, /<script>& "中文"/);
  assert.match(doc.documentElement.textContent, /<image href="https:\/\/bad.invalid"\/>/);
  assert.equal(doc.querySelectorAll('script,foreignObject,image,a').length, 0);
  assert.ok(doc.querySelectorAll('text').length > 0);
  assert.ok(!page.svg.includes('C:/private'));
});

test('presets preserve their aspect ratio and fit a tall graph without clipping', () => {
  const data = map([node('root', null), ...Array.from({ length: 20 }, (_, i) => node('n' + i, 'root'))]);
  for (const [preset, ratio] of [['16:9', 16 / 9], ['16:10', 1.6], ['a4-landscape', 297 / 210]]) {
    const page = buildMindmapExportPages(data, { preset }).pages[0];
    assert.ok(Math.abs(page.width / page.height - ratio) < .001);
    const { x, y, width, height } = page.contentRect;
    assert.ok(x >= 0 && y >= 0 && x + width <= page.width + .01 && y + height <= page.height + .01);
    assert.equal(xml(page).querySelectorAll('[data-node]').length, 21);
  }
});

test('current view respects folds; chapter export expands the chapter and keeps only its descendants', () => {
  const data = map([node('root', null), node('one', 'root', '第一章', { collapsed: true }), node('detail', 'one', '详细内容'), node('deep', 'detail', '深层内容'), node('two', 'root', '第二章')]);
  const before = JSON.stringify(data);
  assert.equal(xml(buildMindmapExportPages(data).pages[0]).querySelectorAll('[data-node]').length, 3);
  const pages = buildMindmapExportPages(data, { scope: 'chapters', preset: '16:10' }).pages;
  assert.equal(pages.length, 3);
  assert.deepEqual([...xml(pages[0]).querySelectorAll('[data-node]')].map(n => n.getAttribute('data-node')), ['root', 'one', 'detail', 'two']);
  assert.deepEqual([...xml(pages[1]).querySelectorAll('[data-node]')].map(n => n.getAttribute('data-node')), ['one', 'detail', 'deep']);
  assert.equal(pages[1].title, '第一章');
  assert.equal(JSON.stringify(data), before, 'export must not change collapse state, offsets, or original data');
});

test('long titles and subtitles remain complete in vector text and grow node bounds', () => {
  const title = '（一）世界局势：百年未有之大变局'.repeat(12);
  const subtitle = '时代条件 → 自身回应'.repeat(10);
  const page = buildMindmapExportPages(map([node('root', null, title, { subtitle })])).pages[0];
  const doc = xml(page), text = doc.querySelector('[data-node]');
  assert.equal([...text.querySelectorAll('[data-role="title"] tspan')].map(n => n.textContent).join(''), title);
  assert.equal([...text.querySelectorAll('[data-role="subtitle"] tspan')].map(n => n.textContent).join(''), subtitle);
  assert.ok(page.height > 400);
});

test('relationships retain requested arrows, color, line style and safe labels', () => {
  const data = map([node('root', null), node('child', 'root')], { lineStyle: 'orthogonal', connections: [{ id: 'r', from: 'root', to: 'child', label: '<说明>', style: 'solid', arrow: 'both', color: '#ab1234' }] });
  const doc = xml(buildMindmapExportPages(data).pages[0]);
  const edge = doc.querySelector('[data-connection]');
  assert.equal(edge.getAttribute('stroke'), '#ab1234');
  assert.equal(edge.getAttribute('stroke-dasharray'), null);
  assert.ok(edge.getAttribute('marker-start') && edge.getAttribute('marker-end'));
  assert.ok(!doc.querySelector('[data-branch]').getAttribute('d').includes('C'));
  assert.ok(doc.documentElement.textContent.includes('<说明>'));
});

test('orthogonal exported siblings preserve the single aligned trunk used by the canvas', () => {
  const data = map([node('root', null, '课程\n三天\n六单元\n完成作品'), ...Array.from({ length: 8 }, (_, index) => node(`n${index}`, 'root'))], { lineStyle: 'orthogonal' });
  const doc = xml(buildMindmapExportPages(data).pages[0]);
  const routes = createMindmapRouter(layoutMindmap(data).positions), trunks = new Set();
  for (const branch of doc.querySelectorAll('[data-branch]')) {
    const route = routes.route('root', branch.getAttribute('data-branch'), { lineStyle: 'orthogonal' });
    assert.equal(branch.getAttribute('d'), route.d, 'all export formats use the same path as the canvas');
    for (let i = 1; i < route.points.length; i++) {
      if (route.points[i].x === route.points[i - 1].x && route.points[i].y !== route.points[i - 1].y) trunks.add(route.points[i].x);
    }
  }
  assert.equal(doc.querySelectorAll('[data-branch]').length, 8);
  assert.equal(trunks.size, 1, 'export must not restore the two offset trunks');
});

test('natural export includes negative manual offsets and rejects unsupported choices', () => {
  const data = map([node('root', null), node('child', 'root', '子主题', { offset: { x: -1000, y: -800 } })]);
  const page = buildMindmapExportPages(data).pages[0];
  assert.ok(page.width > 800 && page.height > 800);
  assert.ok(page.contentRect.x >= 0 && page.contentRect.y >= 0);
  assert.throws(() => buildMindmapExportPages(data, { preset: 'bad' }));
  assert.throws(() => buildMindmapExportPages(data, { scope: 'bad' }));
});

test('relationship leaders sit below opaque node surfaces so they cannot cross the text', () => {
  const data = map([node('root', null), node('one', 'root'), node('two', 'root')], { connections: [{ id: 'r', from: 'one', to: 'two', label: '关联说明' }] });
  const doc = xml(buildMindmapExportPages(data).pages[0]);
  const leader = doc.querySelector('[data-role="connection-leader"]'), nodeElement = doc.querySelector('[data-node="one"]');
  assert.ok(leader);
  assert.ok(leader.compareDocumentPosition(nodeElement) & 4, 'leader must be drawn before the opaque node');
});

test('long chapter headings are wrapped to the actual page width', () => {
  const title = '这是很长的章节标题'.repeat(20);
  const page = buildMindmapExportPages(map([node('root', null), node('one', 'root', title)]), { scope: 'chapters' }).pages[1];
  const heading = xml(page).querySelector('[data-role="page-title"]');
  assert.ok(heading.querySelectorAll('tspan').length > 1);
  assert.equal([...heading.querySelectorAll('tspan')].map(line => line.textContent).join(''), title);
});

test('legal multiline and 500-character chapter titles leave positive graph space in every page preset', () => {
  const titles = [Array(30).fill('一二三四五六七八九十甲乙').join('\n'), '章'.repeat(500)];
  assert.equal(titles[0].length, 389);
  for (const title of titles) for (const preset of ['a4-landscape', 'natural', '16:9', '16:10']) {
    const page = buildMindmapExportPages(map([node('root', null), node('one', 'root', title)]), { scope: 'chapters', preset }).pages[1];
    const doc = xml(page), rect = page.contentRect;
    const transform = [...doc.querySelectorAll('g[transform]')].find(group => group.getAttribute('transform').includes('scale(')).getAttribute('transform');
    const scale = Number(transform.match(/scale\(([^)]+)\)/)[1]);
    assert.ok(Number.isFinite(scale) && scale > 0, `${preset}: positive graph scale for a ${title.length}-character title`);
    assert.ok(rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= page.width + .01 && rect.y + rect.height <= page.height + .01);
    assert.equal(doc.querySelector('svg > title').textContent, title, 'original title remains complete in the document title');
    const heading = doc.querySelector('[data-role="page-title"]');
    const headingBottom = Math.max(...[...heading.querySelectorAll('tspan')].map(line => Number(line.getAttribute('y'))));
    assert.ok(headingBottom <= 36 + page.height * .25, 'page heading cannot consume more than one quarter of the page');
    assert.equal([...doc.querySelectorAll('[data-node="one"] [data-role="title"] tspan')].map(line => line.textContent).join(''), title.replace(/\n/g, ''));
  }
});

test('short two-ended relationships use bounded user-space arrows without overlap', () => {
  for (const gap of [24, 6]) {
    const data = map([node('root', null), node('a', 'root'), node('b', 'root', 'b', { offset: { x: 0, y: gap - 24 } })], { lineStyle: 'orthogonal', connections: [{ id: 'r', from: 'a', to: 'b', arrow: 'both' }] });
    const doc = xml(buildMindmapExportPages(data).pages[0]);
    const marker = doc.querySelector('marker');
    assert.equal(marker.getAttribute('markerUnits'), 'userSpaceOnUse');
    const width = Number(marker.getAttribute('markerWidth'));
    assert.ok(width >= .5 && width <= 8);
    assert.ok(width * 2 < gap, `two arrows must leave a visible line between them in a ${gap}px gap`);
  }
});

test('legacy crystal relationship paths match the view router while branches retain the theme shape', () => {
  const data = { ...map([node('root', null), node('a', 'root'), node('b', 'root')], { theme: 'crystal', connections: [{ id: 'r', from: 'a', to: 'b' }] }), version: 5 };
  const doc = xml(buildMindmapExportPages(data).pages[0]);
  const positions = layoutMindmap(data).positions;
  const viewRoute = createMindmapRouter(positions).route('a', 'b', { lineStyle: data.lineStyle, bow: 32 });
  assert.equal(doc.querySelector('[data-connection]').getAttribute('d'), viewRoute.d);
  assert.match(doc.querySelector('[data-connection]').getAttribute('d'), / C /);
  assert.ok(!doc.querySelector('[data-branch]').getAttribute('d').includes(' C '));
});
