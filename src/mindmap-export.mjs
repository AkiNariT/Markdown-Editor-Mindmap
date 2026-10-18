import { validateMindmap } from './mindmap.mjs';
import { layoutMindmap, measureNode, wrapNodeText } from './mindmap-layout.mjs';
import { createMindmapRouter } from './mindmap-routing.mjs';
import { nodeArtworkPaths } from './mindmap-themes.mjs';
import { t } from './i18n.mjs';

const presets = new Set(['natural', '16:9', '16:10', 'a4-landscape']);
const scopes = new Set(['current', 'chapters']);
const font = 'Arial, Microsoft YaHei, Noto Sans CJK SC, sans-serif';
const themePaint = {
  classic: { paper: '#ffffff', ink: '#343d3b', accent: '#a2aaa3' },
  tree: { paper: '#f3eadc', ink: '#4b3827', accent: '#8b6948' },
  vine: { paper: '#e7f1e5', ink: '#294c35', accent: '#648968' },
  crystal: { paper: '#eae6f6', ink: '#44345e', accent: '#8c75b1' },
};
const n = value => Number(value.toFixed(6));
const escape = value => String(value).toWellFormed().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '\ufffd').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

function foreground(background) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = r * .2126 + g * .7152 + b * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
}

function chapterMaps(data) {
  const children = new Map(data.nodes.map(node => [node.id, []]));
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  for (const node of data.nodes) if (node.parent !== null) children.get(node.parent).push(node.id);
  const clone = (root, allowed, foldAt = Infinity) => {
    const nodes = [];
    const walk = (id, parent, depth) => {
      if (!allowed.has(id)) return;
      const { offset, ...node } = byId.get(id);
      nodes.push({ ...node, parent, collapsed: depth >= foldAt && children.get(id).length > 0 });
      if (depth < foldAt) for (const child of children.get(id)) walk(child, id, depth + 1);
    };
    walk(root, null, 0);
    const included = new Set(nodes.map(node => node.id));
    return { ...data, root, nodes, ...(data.version >= 2 ? { connections: data.connections.filter(edge => included.has(edge.from) && included.has(edge.to)) } : {}) };
  };
  const pages = [{ title: t('总览'), map: clone(data.root, new Set(byId.keys()), 2) }];
  for (const chapter of children.get(data.root)) {
    const allowed = new Set();
    const visit = id => { allowed.add(id); for (const child of children.get(id)) visit(child); };
    visit(chapter);
    pages.push({ title: byId.get(chapter).text || t('未命名主题'), map: clone(chapter, allowed) });
  }
  if (pages.length > 100) throw new Error(t('一次最多导出 100 页，请减少一级章节数量。'));
  return pages;
}

function textBlock(lines, { x, y, fontSize, lineHeight, color, role, weight = 400 }) {
  if (!lines.length) return '';
  return `<text data-role="${role}" fill="${color}" font-size="${fontSize}" font-weight="${weight}" xml:space="preserve">${lines.map((line, index) => `<tspan x="${n(x)}" y="${n(y + index * lineHeight)}">${escape(line)}</tspan>`).join('')}</text>`;
}

function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

function pageHeading(title, width, heightBudget) {
  // A title may legally contain hundreds of explicit line breaks. The page
  // header is compact; the complete original remains in the node and <title>.
  const text = title.replace(/\s+/gu, ' ').trim() || t('未命名主题');
  let fontSize = 22, lineHeight, lines;
  const measure = () => { lineHeight = Math.ceil(fontSize * 28 / 22); lines = wrapNodeText(text, width, fontSize); };
  measure();
  while (fontSize > 8 && lines.length * lineHeight + 22 > heightBudget) { fontSize--; measure(); }
  const maximumLines = Math.max(1, Math.floor((heightBudget - 22) / lineHeight));
  if (lines.length > maximumLines) {
    lines = lines.slice(0, maximumLines);
    lines[lines.length - 1] = Array.from(lines.at(-1)).slice(0, -1).join('') + '…';
  }
  return { lines, fontSize, lineHeight, height: lines.length * lineHeight + 22 };
}

function renderPage(data, title, preset, includeHeading) {
  const layout = layoutMindmap(data), positions = layout.positions;
  const paint = themePaint[data.theme] || themePaint.classic;
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const router = createMindmapRouter(positions);
  const bounds = { ...layout.bounds };
  const extend = rectangle => {
    bounds.left = Math.min(bounds.left, rectangle.left); bounds.top = Math.min(bounds.top, rectangle.top);
    bounds.right = Math.max(bounds.right, rectangle.right); bounds.bottom = Math.max(bounds.bottom, rectangle.bottom);
  };
  const branchMarkup = [], leaderMarkup = [], labelMarkup = [], nodeMarkup = [], definitions = [];
  const obstacles = [...positions.values()].map(position => ({ left: position.x - 6, top: position.y - 6, right: position.x + position.width + 6, bottom: position.y + position.height + 6 }));
  const routeOptions = { lineStyle: data.lineStyle || 'curve', crystal: !data.lineStyle && data.theme === 'crystal' };
  for (const node of data.nodes) {
    if (!positions.has(node.id) || node.parent === null || !positions.has(node.parent)) continue;
    const route = router.route(node.parent, node.id, routeOptions);
    if (!route) continue;
    extend(route.bounds);
    let depth = 0, ancestor = node;
    while (ancestor.parent !== null) { depth++; ancestor = byId.get(ancestor.parent); }
    const width = data.theme === 'tree' ? Math.max(1.6, 5 - depth * .65) : data.theme === 'vine' ? 2.4 : 1.8;
    branchMarkup.push(`<path data-branch="${escape(node.id)}" d="${route.d}" fill="none" stroke="${paint.accent}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const [index, edge] of (data.connections || []).entries()) {
    if (!positions.has(edge.from) || !positions.has(edge.to)) continue;
    const route = router.route(edge.from, edge.to, { lineStyle: data.lineStyle, bow: 32 });
    if (!route) continue;
    extend(route.bounds);
    const color = edge.color || paint.ink, arrowId = `arrow-${index}`;
    if (edge.arrow && edge.arrow !== 'none') {
      const length = route.points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - route.points[i].x, point.y - route.points[i].y), 0);
      const size = n(Math.max(.5, Math.min(8, length / (edge.arrow === 'both' ? 3 : 1.5))));
      definitions.push(`<marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${color}"/></marker>`);
    }
    branchMarkup.push(`<path data-connection="${escape(edge.id)}" d="${route.d}" fill="none" stroke="${color}" stroke-width="2"${(edge.style || 'dashed') === 'dashed' ? ' stroke-dasharray="7 5"' : ''}${edge.arrow === 'both' ? ` marker-start="url(#${arrowId})"` : ''}${edge.arrow && edge.arrow !== 'none' ? ` marker-end="url(#${arrowId})"` : ''}/>`);
    if (edge.label) {
      const lines = wrapNodeText(edge.label, 240, 12), width = 260, height = lines.length * 18 + 12;
      const { x, y } = route.midpoint;
      let box;
      for (let radius = 0; radius <= 12 && !box; radius++) {
        for (const [dx, dy] of [[0, -radius], [0, radius], [-radius, 0], [radius, 0]]) {
          const candidate = { left: x + dx * 32 - width / 2, right: x + dx * 32 + width / 2, top: y + dy * 32 - height / 2, bottom: y + dy * 32 + height / 2 };
          if (!obstacles.some(obstacle => overlaps(candidate, obstacle))) { box = candidate; break; }
        }
      }
      if (!box) box = { left: bounds.right + 24, right: bounds.right + width + 24, top: y - height / 2, bottom: y + height / 2 };
      obstacles.push(box); extend(box);
      const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
      if (Math.abs(cx - x) + Math.abs(cy - y) > 1) leaderMarkup.push(`<path data-role="connection-leader" d="M ${n(x)} ${n(y)} L ${n(cx)} ${n(cy)}" fill="none" stroke="${color}" stroke-dasharray="2 3"/>`);
      labelMarkup.push(`<rect x="${n(box.left)}" y="${n(box.top)}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="${paint.accent}"/>${textBlock(lines, { x: box.left + 10, y: box.top + 18, fontSize: 12, lineHeight: 18, color, role: 'connection-label' })}`);
    }
  }
  for (const node of data.nodes) {
    const position = positions.get(node.id); if (!position) continue;
    const { x, y, width, height } = position, metrics = measureNode(node, data.nodeSize);
    const background = node.background || paint.paper, border = node.background ? foreground(background) : paint.accent;
    const color = node.color || (node.background ? foreground(background) : paint.ink);
    let surface;
    const art = nodeArtworkPaths(data.theme, width, height);
    if (art) {
      surface = `<g transform="translate(${n(x)} ${n(y)})"><path d="${art[0]}" fill="${background}" stroke="${border}" stroke-width="1.3"/><path d="${art[1]}" fill="none" stroke="${border}" stroke-width="1" opacity=".35"/></g>`;
    } else {
      const shape = data.theme || node.style;
      const radius = shape === 'capsule' ? 48 : shape === 'rounded' ? 22 : 8;
      surface = `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${n(radius)}" fill="${background}" stroke="${border}" stroke-width="${node.id === data.root ? 1.5 : 1}"/>`;
    }
    const titleLines = metrics.titleLines, subtitleLines = metrics.subtitleLines;
    const textHeight = titleLines.length * metrics.titleLineHeight + (subtitleLines.length ? metrics.subtitleGap + subtitleLines.length * metrics.subtitleLineHeight : 0);
    const textTop = y + (height - textHeight) / 2;
    const titleText = textBlock(titleLines, { x: x + metrics.paddingX, y: textTop + metrics.titleFontSize, fontSize: metrics.titleFontSize, lineHeight: metrics.titleLineHeight, color, role: 'title', weight: node.id === data.root ? 600 : 400 });
    const subtitleText = textBlock(subtitleLines, { x: x + metrics.paddingX, y: textTop + titleLines.length * metrics.titleLineHeight + metrics.subtitleGap + metrics.subtitleFontSize, fontSize: metrics.subtitleFontSize, lineHeight: metrics.subtitleLineHeight, color, role: 'subtitle' });
    let star = node.file ? `<text x="${n(x + width - 25)}" y="${n(y + 25)}" fill="${color}" font-size="16">★</text>` : '';
    nodeMarkup.push(`<g data-node="${escape(node.id)}">${surface}${titleText}${subtitleText}${star}</g>`);
  }
  // Extra space accounts for stroke widths and arrowheads at the bounds.
  const graphWidth = Math.max(1, bounds.right - bounds.left + 24), graphHeight = Math.max(1, bounds.bottom - bounds.top + 24);
  const margin = 36;
  const pageWidth = preset === 'natural' ? graphWidth + margin * 2 : preset === 'a4-landscape' ? 1122.52 : 1920;
  const fixedPageHeight = preset === '16:9' ? 1080 : preset === '16:10' ? 1200 : 793.701;
  const headingBudget = preset === 'natural' ? (graphHeight + margin * 2) / 3 : fixedPageHeight * .22;
  const headingLayout = includeHeading ? pageHeading(title, pageWidth - margin * 2, headingBudget) : { lines: [], fontSize: 22, lineHeight: 28, height: 0 };
  const headingHeight = headingLayout.height;
  const dimensions = preset === '16:9' ? [1920, 1080] : preset === '16:10' ? [1920, 1200] : preset === 'a4-landscape' ? [1122.52, 793.701] : [pageWidth, graphHeight + margin * 2 + headingHeight];
  const [width, height] = dimensions;
  const scale = Math.min((width - margin * 2) / graphWidth, (height - margin * 2 - headingHeight) / graphHeight);
  const contentRect = { x: (width - graphWidth * scale) / 2, y: margin + headingHeight + (height - margin * 2 - headingHeight - graphHeight * scale) / 2, width: graphWidth * scale, height: graphHeight * scale };
  const heading = textBlock(headingLayout.lines, { x: margin, y: margin + headingLayout.fontSize, fontSize: headingLayout.fontSize, lineHeight: headingLayout.lineHeight, color: paint.ink, role: 'page-title' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" font-family="${font}" role="img"><title>${escape(title)}</title><defs>${definitions.join('')}</defs><rect width="100%" height="100%" fill="#ffffff"/>${heading}<g transform="translate(${n(contentRect.x)} ${n(contentRect.y)}) scale(${n(scale)}) translate(${n(12 - bounds.left)} ${n(12 - bounds.top)})">${branchMarkup.join('')}${leaderMarkup.join('')}${nodeMarkup.join('')}${labelMarkup.join('')}</g></svg>`;
  return { title, width, height, svg, contentRect };
}

/** Build inert, standalone SVG pages. No filesystem paths or HTML are embedded. */
export function buildMindmapExportPages(value, { preset = 'natural', scope = 'current' } = {}) {
  if (!presets.has(preset) || !scopes.has(scope)) throw new Error(t('导出页面或范围选项无效。'));
  const data = validateMindmap(value);
  const maps = scope === 'chapters' ? chapterMaps(data) : [{ title: data.nodes.find(node => node.id === data.root).text || t('未命名主题'), map: data }];
  const pages = maps.map(item => renderPage(item.map, item.title, preset, scope === 'chapters'));
  if (pages.reduce((sum, page) => sum + page.svg.length, 0) > 32 * 1024 * 1024) throw new Error(t('导出内容过大，请分章导出或减少节点。'));
  return { pages, preset, scope };
}
