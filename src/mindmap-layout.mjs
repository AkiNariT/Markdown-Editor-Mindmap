const WIDTHS = { compact: 180, standard: 216, wide: 320 };
const COLUMN_GAP = 76, ROW_GAP = 24;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function advance(text, fontSize) {
  // A conservative font-independent measure shared by DOM and SVG. Explicit
  // lines avoid browser-specific wrapping changing the saved layout or export.
  if (/^\s+$/u.test(text)) return text === '\t' ? fontSize * 2 : fontSize * .38;
  if (/^[\x20-\x7e]$/u.test(text)) return fontSize * (/[MW@#%&]/.test(text) ? .95 : .64);
  return fontSize * 1.05;
}

export function wrapNodeText(text, maxWidth, fontSize = 16) {
  const available = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : fontSize;
  const lines = [];
  for (const paragraph of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', used = 0;
    for (const { segment } of graphemes.segment(paragraph)) {
      const width = advance(segment, fontSize);
      if (line && used + width > available) { lines.push(line); line = ''; used = 0; }
      line += segment; used += width;
    }
    lines.push(line);
  }
  return lines;
}

export function measureNode(node, nodeSize = 'standard') {
  const width = WIDTHS[nodeSize] || WIDTHS.standard;
  const paddingX = 32, paddingY = 18, subtitleGap = 8;
  const titleFontSize = 16, subtitleFontSize = 13, titleLineHeight = 23, subtitleLineHeight = 19;
  const textWidth = width - paddingX * 2 - (node.file ? 22 : 0);
  const titleLines = wrapNodeText(node.text, textWidth, titleFontSize);
  const subtitleLines = node.subtitle ? wrapNodeText(node.subtitle, textWidth, subtitleFontSize) : [];
  const height = Math.max(96, paddingY * 2 + titleLines.length * titleLineHeight + (subtitleLines.length ? subtitleGap + subtitleLines.length * subtitleLineHeight : 0));
  return { width, height, titleLines, subtitleLines, titleFontSize, subtitleFontSize, titleLineHeight, subtitleLineHeight, paddingX, paddingY, subtitleGap };
}

/** Coordinates are document-space top-lefts. Negative manual offsets remain
 * intact; the caller may translate bounds and retain its viewport padding. */
export function layoutMindmap(data, { paddingX = 0, paddingY = 0, drag = null } = {}) {
  const byId = new Map(data.nodes.map(item => [item.id, item]));
  const children = new Map(data.nodes.map(item => [item.id, []]));
  for (const item of data.nodes) if (item.parent !== null) children.get(item.parent).push(item);
  const sizes = new Map(data.nodes.map(item => [item.id, measureNode(item, data.nodeSize)])), heights = new Map();
  function treeHeight(item) {
    const list = item.collapsed ? [] : children.get(item.id);
    const height = Math.max(sizes.get(item.id).height, list.reduce((sum, child) => sum + treeHeight(child), 0) + Math.max(0, list.length - 1) * ROW_GAP);
    heights.set(item.id, height); return height;
  }
  treeHeight(byId.get(data.root));
  const positions = new Map();
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  function place(item, depth, top, ancestorOffset = { x: 0, y: 0 }) {
    const size = sizes.get(item.id);
    const offset = { x: ancestorOffset.x + (item.offset?.x || 0), y: ancestorOffset.y + (item.offset?.y || 0) };
    if (drag?.kind === 'node' && drag.nodeIds?.has(item.id)) { offset.x += drag.dx; offset.y += drag.dy; }
    const x = paddingX + depth * (size.width + COLUMN_GAP) + offset.x;
    const y = top + (heights.get(item.id) - size.height) / 2 + offset.y;
    positions.set(item.id, { x, y, width: size.width, height: size.height });
    bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + size.width); bounds.bottom = Math.max(bounds.bottom, y + size.height);
    if (!item.collapsed) {
      let childTop = top;
      for (const child of children.get(item.id)) { place(child, depth + 1, childTop, offset); childTop += heights.get(child.id) + ROW_GAP; }
    }
  }
  place(byId.get(data.root), 0, paddingY);
  return { positions, children, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, bounds };
}
