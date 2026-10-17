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
  const start = positions.get(anchorId), anchor = start && { x: start.x, y: start.y };
  const stationary = [];
  for (const [id, point] of positions) {
    if (!moving.has(id) && Number.isFinite(point.x) && Number.isFinite(point.y)) stationary.push({ id, key: String(id), x: point.x, y: point.y });
  }
  // All cards share a size: left-left, center-center and right-right produce
  // exactly the same delta. Keep one candidate and show the center guide. Do
  // not attract facing edges or edge-to-center pairs in neighboring columns.
  const byX = stationary.slice().sort((a, b) => a.x - b.x);
  const byY = stationary.slice().sort((a, b) => a.y - b.y);

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
        axis: 'x', value: horizontal.target.x + width / 2,
        start: Math.min(anchor.y + snappedY, horizontal.target.y) - margin,
        end: Math.max(anchor.y + snappedY, horizontal.target.y) + height + margin,
        targetId: horizontal.target.id,
      });
      if (vertical) guides.push({
        axis: 'y', value: vertical.target.y + height / 2,
        start: Math.min(anchor.x + snappedX, vertical.target.x) - margin,
        end: Math.max(anchor.x + snappedX, vertical.target.x) + width + margin,
        targetId: vertical.target.id,
      });
      return { dx: snappedX, dy: snappedY, guides };
    },
  };
}
