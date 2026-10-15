export const mapThemes = Object.freeze(['classic', 'rounded', 'capsule', 'tree', 'vine', 'crystal']);
export const nodePalettes = Object.freeze([
  { id: 'default', label: '默认', background: null, color: null },
  { id: 'gray', label: '灰色', background: '#e5e7eb', color: '#26313d' },
  { id: 'blue', label: '蓝色', background: '#dbeafe', color: '#1e3a5f' },
  { id: 'green', label: '绿色', background: '#dcf0df', color: '#244b35' },
  { id: 'purple', label: '紫色', background: '#eee3f7', color: '#53366c' },
  { id: 'pink', label: '粉色', background: '#f8e1e9', color: '#713d54' },
  { id: 'orange', label: '橙色', background: '#ffead5', color: '#724523' },
  { id: 'brown', label: '棕色', background: '#eadecf', color: '#57402c' },
].map(Object.freeze));

const outlines = {
  tree: 'M 18 4 Q 73 0 126 4 L 192 3 Q 211 4 213 21 L 211 70 Q 214 90 195 92 L 124 90 Q 67 96 19 91 Q 3 90 4 73 L 2 25 Q 2 7 18 4 Z',
  vine: 'M 3 49 Q 3 3 51 3 L 180 3 Q 213 3 213 47 Q 213 93 165 93 L 36 93 Q 3 93 3 49 Z',
  crystal: 'M 24 3 L 190 3 L 213 24 L 213 72 L 191 93 L 24 93 L 3 72 L 3 24 Z',
};
const details = {
  tree: 'M 9 27 Q 14 43 10 63 M 17 29 Q 21 45 17 59 M 191 73 Q 204 66 201 53 M 192 81 Q 209 73 208 56',
  vine: 'M 9 69 Q 23 62 23 46 M 20 56 Q 7 52 11 41 Q 23 43 20 56 M 194 26 Q 181 29 183 16 Q 196 14 194 26 M 191 31 Q 202 29 204 19',
  crystal: 'M 24 3 L 32 14 L 183 14 L 190 3 M 213 24 L 197 30 L 197 67 L 213 72 M 191 93 L 182 82 L 32 82 L 24 93 M 3 24 L 18 30 L 18 67 L 3 72',
};

// Paint the surface without clipping the node's hit area, text or controls.
export function createNodeArtwork(document, theme) {
  if (!Object.hasOwn(outlines, theme)) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mindmap-node-art'); svg.setAttribute('viewBox', '0 0 216 96');
  svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  for (const [className, d] of [['mindmap-node-outline', outlines[theme]], ['mindmap-node-detail', details[theme]]]) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); path.setAttribute('class', className); svg.append(path);
  }
  return svg;
}

export function crystalBranch(from, to, width = 216, height = 96) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const horizontal = Math.abs(dx) > Math.abs(dy), direction = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  const start = horizontal ? { x: from.x + (direction > 0 ? width : 0), y: from.y + height / 2 } : { x: from.x + width / 2, y: from.y + (direction > 0 ? height : 0) };
  const end = horizontal ? { x: to.x + (direction > 0 ? 0 : width), y: to.y + height / 2 } : { x: to.x + width / 2, y: to.y + (direction > 0 ? 0 : height) };
  const midX = (start.x + end.x) / 2, midY = (start.y + end.y) / 2;
  return horizontal
    ? `M ${start.x} ${start.y} L ${midX - direction * 12} ${start.y} L ${midX + direction * 12} ${end.y} L ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} L ${start.x} ${midY - direction * 12} L ${end.x} ${midY + direction * 12} L ${end.x} ${end.y}`;
}
