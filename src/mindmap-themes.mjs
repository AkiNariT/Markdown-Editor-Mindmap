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

// Extend the middle of the card rather than scaling its corners and ornaments.
// In particular, tall cards retain 3px top/bottom borders around the text area's
// fixed 18px vertical inset. The same paths are used by the view and SVG export.
export function nodeArtworkPaths(theme, width = 216, height = 96) {
  if (!['tree', 'vine', 'crystal'].includes(theme)) return null;
  const x = width - 216, y = height - 96;
  if (theme === 'tree') return [
    `M 18 4 Q 73 0 ${126 + x} 4 L ${192 + x} 3 Q ${211 + x} 4 ${213 + x} 21 L ${211 + x} ${70 + y} Q ${214 + x} ${90 + y} ${195 + x} ${92 + y} L ${124 + x} ${90 + y} Q 67 ${96 + y} 19 ${91 + y} Q 3 ${90 + y} 4 ${73 + y} L 2 25 Q 2 7 18 4 Z`,
    `M 9 27 Q 14 43 10 63 M 17 29 Q 21 45 17 59 M ${191 + x} ${73 + y} Q ${204 + x} ${66 + y} ${201 + x} ${53 + y} M ${192 + x} ${81 + y} Q ${209 + x} ${73 + y} ${208 + x} ${56 + y}`,
  ];
  if (theme === 'vine') return [
    `M 3 49 Q 3 3 51 3 L ${180 + x} 3 Q ${213 + x} 3 ${213 + x} 47 L ${213 + x} ${47 + y} Q ${213 + x} ${93 + y} ${165 + x} ${93 + y} L 36 ${93 + y} Q 3 ${93 + y} 3 ${49 + y} L 3 49 Z`,
    `M 9 ${69 + y} Q 23 ${62 + y} 23 ${46 + y} M 20 ${56 + y} Q 7 ${52 + y} 11 ${41 + y} Q 23 ${43 + y} 20 ${56 + y} M ${194 + x} 26 Q ${181 + x} 29 ${183 + x} 16 Q ${196 + x} 14 ${194 + x} 26 M ${191 + x} 31 Q ${202 + x} 29 ${204 + x} 19`,
  ];
  return [
    `M 24 3 L ${190 + x} 3 L ${213 + x} 24 L ${213 + x} ${72 + y} L ${191 + x} ${93 + y} L 24 ${93 + y} L 3 ${72 + y} L 3 24 Z`,
    `M 24 3 L 32 14 L ${183 + x} 14 L ${190 + x} 3 M ${213 + x} 24 L ${197 + x} 30 L ${197 + x} ${67 + y} L ${213 + x} ${72 + y} M ${191 + x} ${93 + y} L ${182 + x} ${82 + y} L 32 ${82 + y} L 24 ${93 + y} M 3 24 L 18 30 L 18 ${67 + y} L 3 ${72 + y}`,
  ];
}

// Paint the surface without clipping the node's hit area, text or controls.
export function createNodeArtwork(document, theme, { width = 216, height = 96 } = {}) {
  const paths = nodeArtworkPaths(theme, width, height);
  if (!paths) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mindmap-node-art'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  for (const [className, d] of [['mindmap-node-outline', paths[0]], ['mindmap-node-detail', paths[1]]]) {
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
