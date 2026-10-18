const EPSILON = 1e-7;

function lowerBound(entries, axis, value) {
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle][axis] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function closest(entries, axis, origin, delta, otherCoordinate, radius, minimum, maximum) {
  const value = origin + delta, otherAxis = axis === 'x' ? 'y' : 'x';
  let best;
  for (let i = lowerBound(entries, axis, value - radius - EPSILON); i < entries.length && entries[i][axis] <= value + radius + EPSILON; i++) {
    const target = entries[i], snappedDelta = target[axis] - origin;
    // The caller clamps the raw group movement. Only reachable alignments may
    // replace it; showing a guide for an unreachable card would be misleading.
    if (snappedDelta < minimum || snappedDelta > maximum) continue;
    const error = Math.abs(target[axis] - value), otherDistance = Math.abs(target[otherAxis] - otherCoordinate);
    if (!best || error < best.error - EPSILON || Math.abs(error - best.error) <= EPSILON && (
      otherDistance < best.otherDistance - EPSILON || Math.abs(otherDistance - best.otherDistance) <= EPSILON && target.key < best.target.key
    )) best = { target, delta: snappedDelta, error, otherDistance };
  }
  return best;
}

/** Create once per drag, from visible document-space card positions. */
export function createMindmapSnapper(positions, { anchorId, movingIds = [], width = 216, height = 96, threshold = 6 } = {}) {
  const moving = new Set(movingIds); moving.add(anchorId);
  const dimension = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const start = positions.get(anchorId), anchor = start && { x: start.x, y: start.y, width: dimension(start.width, width), height: dimension(start.height, height) };
  const stationary = [];
  for (const [id, point] of positions) {
    if (!moving.has(id) && Number.isFinite(point.x) && Number.isFinite(point.y)) stationary.push({ id, key: String(id), x: point.x, y: point.y, width: dimension(point.width, width), height: dimension(point.height, height) });
  }
  // Match like anchors only. Equal dimensions collapse to the center candidate;
  // differently sized cards may align their corresponding edges or centers.
  function candidates(axis, size) {
    if (!anchor) return [];
    return stationary.flatMap(target => (target[size] === anchor[size] ? [.5] : [.5, 0, 1]).map((fraction, index) => ({
      ...target, cardX: target.x, cardY: target.y, key: `${target.key}:${index}`,
      [axis]: target[axis] + (target[size] - anchor[size]) * fraction,
      guide: target[axis] + target[size] * fraction,
    }))).sort((a, b) => a[axis] - b[axis]);
  }
  const byX = candidates('x', 'width'), byY = candidates('y', 'height');

  return {
    snap(dx, dy, { zoom = 100, disabled = false, bounds = {} } = {}) {
      if (disabled || !anchor || !Number.isFinite(dx) || !Number.isFinite(dy)) return { dx, dy, guides: [] };
      const scale = Number.isFinite(zoom) && zoom > 0 ? zoom / 100 : 1;
      const radius = threshold / scale;
      const horizontal = closest(byX, 'x', anchor.x, dx, anchor.y + dy, radius, bounds.minDx ?? -Infinity, bounds.maxDx ?? Infinity);
      const vertical = closest(byY, 'y', anchor.y, dy, anchor.x + dx, radius, bounds.minDy ?? -Infinity, bounds.maxDy ?? Infinity);
      const snappedX = horizontal ? horizontal.delta : dx, snappedY = vertical ? vertical.delta : dy;
      const guides = [], margin = 12 / scale;
      if (horizontal) guides.push({
        axis: 'x', value: horizontal.target.guide,
        start: Math.min(anchor.y + snappedY, horizontal.target.cardY) - margin,
        end: Math.max(anchor.y + snappedY + anchor.height, horizontal.target.cardY + horizontal.target.height) + margin,
        targetId: horizontal.target.id,
      });
      if (vertical) guides.push({
        axis: 'y', value: vertical.target.guide,
        start: Math.min(anchor.x + snappedX, vertical.target.cardX) - margin,
        end: Math.max(anchor.x + snappedX + anchor.width, vertical.target.cardX + vertical.target.width) + margin,
        targetId: vertical.target.id,
      });
      return { dx: snappedX, dy: snappedY, guides };
    },
  };
}
