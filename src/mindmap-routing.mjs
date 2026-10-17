// Keep ordinary branches unchanged; reroute only when a visible card is in the
// way. The index belongs to one render, so collapsed/moved cards cannot leave
// stale obstacles behind. Search has a finite budget even for crowded maps.
const EPSILON = .00001;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const equal = (a, b) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const segmentBounds = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
const boundsOf = points => {
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const right = Math.max(...points.map(p => p.x)), bottom = Math.max(...points.map(p => p.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

function hitsRectangle(a, b, rect) {
  // Open interiors allow a route to run along the clearance boundary. Shrinking
  // by epsilon also makes terminal attachment on the actual card edge legal.
  const left = rect.left + EPSILON, right = rect.right - EPSILON;
  const top = rect.top + EPSILON, bottom = rect.bottom - EPSILON;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < EPSILON) return a.x >= left && a.x <= right && Math.max(a.y, b.y) >= top && Math.min(a.y, b.y) <= bottom;
  if (Math.abs(dy) < EPSILON) return a.y >= top && a.y <= bottom && Math.max(a.x, b.x) >= left && Math.min(a.x, b.x) <= right;
  const firstX = (left - a.x) / dx, lastX = (right - a.x) / dx;
  const firstY = (top - a.y) / dy, lastY = (bottom - a.y) / dy;
  return Math.max(0, Math.min(firstX, lastX), Math.min(firstY, lastY)) <= Math.min(1, Math.max(firstX, lastX), Math.max(firstY, lastY));
}

function spatialIndex(rectangles, cellSize) {
  const cells = new Map();
  for (const rect of rectangles) {
    for (let x = Math.floor(rect.left / cellSize); x <= Math.floor(rect.right / cellSize); x++) {
      for (let y = Math.floor(rect.top / cellSize); y <= Math.floor(rect.bottom / cellSize); y++) {
        const key = `${x},${y}`, entries = cells.get(key) || [];
        entries.push(rect); cells.set(key, entries);
      }
    }
  }
  return bounds => {
    const x0 = Math.floor(bounds.left / cellSize), x1 = Math.floor(bounds.right / cellSize);
    const y0 = Math.floor(bounds.top / cellSize), y1 = Math.floor(bounds.bottom / cellSize);
    const overlap = rect => rect.left <= bounds.right && rect.right >= bounds.left && rect.top <= bounds.bottom && rect.bottom >= bounds.top;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 128) return rectangles.filter(overlap);
    const result = [], seen = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      for (const rect of cells.get(`${x},${y}`) || []) {
        if (!seen.has(rect.id) && overlap(rect)) { seen.add(rect.id); result.push(rect); }
      }
    }
    return result;
  };
}

function simplify(points) {
  const result = [];
  for (const point of points) {
    if (result.length && equal(point, result.at(-1))) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      const forward = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y);
      if (Math.abs(cross) > EPSILON || forward < 0) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function describe(d, points, rerouted, blocked = false) {
  let total = 0;
  const lengths = points.slice(1).map((p, i) => {
    const length = Math.hypot(p.x - points[i].x, p.y - points[i].y); total += length; return length;
  });
  let remaining = total / 2, midpoint = { ...points[0] };
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const ratio = remaining / lengths[i], a = points[i], b = points[i + 1];
      midpoint = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }; break;
    }
    remaining -= lengths[i];
  }
  return { d, points, rerouted, midpoint, bounds: boundsOf(points), ...(blocked ? { blocked: true } : {}) };
}

function legacyRoute(from, to, width, height, columnGap, bow, crystal) {
  const dx = to.x - from.x, dy = to.y - from.y, horizontal = Math.abs(dx) > Math.abs(dy);
  const direction = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  const a = horizontal ? { x: from.x + (direction > 0 ? width : 0), y: from.y + height / 2 }
    : { x: from.x + width / 2, y: from.y + (direction > 0 ? height : 0) };
  const b = horizontal ? { x: to.x + (direction > 0 ? 0 : width), y: to.y + height / 2 }
    : { x: to.x + width / 2, y: to.y + (direction > 0 ? 0 : height) };
  const gap = (horizontal ? b.x - a.x : b.y - a.y) * direction;
  const bend = gap >= 0 ? gap / 2 : Math.max(columnGap / 2, Math.abs(gap) / 2);
  if (crystal) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const c = horizontal ? { x: mx - direction * 12, y: a.y } : { x: a.x, y: my - direction * 12 };
    const e = horizontal ? { x: mx + direction * 12, y: b.y } : { x: b.x, y: my + direction * 12 };
    return describe(`M ${a.x} ${a.y} L ${c.x} ${c.y} L ${e.x} ${e.y} L ${b.x} ${b.y}`, [a, c, e, b], false);
  }
  const c = horizontal ? { x: a.x + direction * bend, y: a.y - bow } : { x: a.x + bow, y: a.y + direction * bend };
  const e = horizontal ? { x: b.x - direction * bend, y: b.y - bow } : { x: b.x + bow, y: b.y - direction * bend };
  const points = [a];
  const halfway = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  function flatten(p, q, r, s, depth) {
    // Distance of the controls from the chord alone misses backwards, collinear
    // loops. The control polygon's excess length catches those as well.
    const polygon = Math.hypot(q.x - p.x, q.y - p.y) + Math.hypot(r.x - q.x, r.y - q.y) + Math.hypot(s.x - r.x, s.y - r.y);
    const chord = Math.hypot(s.x - p.x, s.y - p.y);
    const deviation = chord ? Math.max(
      Math.abs((s.x - p.x) * (q.y - p.y) - (s.y - p.y) * (q.x - p.x)),
      Math.abs((s.x - p.x) * (r.y - p.y) - (s.y - p.y) * (r.x - p.x)),
    ) / chord : polygon;
    if (depth >= 9 || (polygon - chord < .15 && deviation < .5)) { points.push(s); return; }
    const pq = halfway(p, q), qr = halfway(q, r), rs = halfway(r, s), left = halfway(pq, qr), right = halfway(qr, rs), mid = halfway(left, right);
    flatten(p, pq, left, mid, depth + 1); flatten(mid, right, rs, s, depth + 1);
  }
  flatten(a, c, e, b, 0);
  return describe(`M ${a.x} ${a.y} C ${c.x} ${c.y}, ${e.x} ${e.y}, ${b.x} ${b.y}`, points, false);
}

class MinHeap {
  items = [];
  push(item) {
    let index = this.items.length; this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].priority <= item.priority) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].priority < this.items[child].priority) child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child]; index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

/**
 * Route between visible nodes. Coordinates are the top-left card positions.
 * Missing/self edges return null. points approximate cubic paths and are exact
 * vertices for rerouted paths; midpoint follows the drawn path's length.
 * blocked=true means overlapping cards or the bounded search prevented a clear
 * route; the finite legacy path is retained as a best-effort fallback.
 */
export function createMindmapRouter(positions, {
  width = 216, height = 96, columnGap = 76, clearance = 8, rightExtra = 14, maxSearch = 6000,
} = {}) {
  const cards = new Map();
  for (const [id, point] of positions) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    const card = { id, x: point.x, y: point.y, left: point.x, top: point.y, right: point.x + width, bottom: point.y + height };
    cards.set(id, card);
  }
  const rectangles = [...cards.values()].map(card => ({ id: card.id, left: card.left - clearance, top: card.top - clearance, right: card.right + rightExtra + clearance, bottom: card.bottom + clearance }));
  const expanded = new Map(rectangles.map(rect => [rect.id, rect]));
  const query = spatialIndex(rectangles, Math.max(256, width + rightExtra + clearance * 2));
  const outer = rectangles.length ? {
    left: Math.min(...rectangles.map(r => r.left)) - clearance,
    top: Math.min(...rectangles.map(r => r.top)) - clearance,
    right: Math.max(...rectangles.map(r => r.right)) + clearance,
    bottom: Math.max(...rectangles.map(r => r.bottom)) + clearance,
  } : { left: 0, top: 0, right: 0, bottom: 0 };
  let baseX, baseY;
  const segmentClear = (a, b, ignore) => !query(segmentBounds(a, b)).some(rect => rect.id !== ignore && hitsRectangle(a, b, rect));
  const pathClear = points => points.slice(1).every((p, i) => segmentClear(points[i], p));

  function ports(card, preferred) {
    const rect = expanded.get(card.id), mx = card.x + width / 2, my = card.y + height / 2;
    return [
      { point: { x: card.right, y: my }, stub: { x: rect.right, y: my }, direction: 0 },
      { point: { x: mx, y: card.bottom }, stub: { x: mx, y: rect.bottom }, direction: 1 },
      { point: { x: card.left, y: my }, stub: { x: rect.left, y: my }, direction: 0 },
      { point: { x: mx, y: card.top }, stub: { x: mx, y: rect.top }, direction: 1 },
    ].filter(port => segmentClear(port.point, port.stub, card.id))
      .map(port => ({ ...port, penalty: equal(port.point, preferred) ? 0 : 8 }));
  }

  function quickRoute(starts, ends, envelope) {
    const candidates = [];
    for (const start of starts) for (const end of ends) {
      const a = start.stub, b = end.stub;
      const paths = [
        [a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b],
        ...[envelope.top, envelope.bottom].map(y => [a, { x: a.x, y }, { x: b.x, y }, b]),
        ...[envelope.left, envelope.right].map(x => [a, { x, y: a.y }, { x, y: b.y }, b]),
      ];
      for (const path of paths) {
        const middle = simplify(path), full = simplify([start.point, ...middle, end.point]);
        const length = full.slice(1).reduce((sum, p, i) => sum + distance(p, full[i]), 0);
        candidates.push({ middle, full, score: length + (full.length - 2) * 8 + start.penalty + end.penalty });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.find(candidate => pathClear(candidate.middle))?.full || null;
  }

  function corridorRoute(from, to, starts, ends) {
    // A default tree has a long, empty column between the root and its children.
    // Use that column directly instead of testing scores of exterior detours for
    // every child in a large star. The analogous row handles vertical layouts.
    const horizontal = to.left >= from.right + clearance * 2 + rightExtra || from.left >= to.right + clearance * 2 + rightExtra;
    const vertical = to.top >= from.bottom + clearance * 2 || from.top >= to.bottom + clearance * 2;
    for (const axis of horizontal ? ['x', ...(vertical ? ['y'] : [])] : vertical ? ['y'] : []) {
      const forward = axis === 'x' ? to.x > from.x : to.y > from.y;
      const a = starts.find(port => axis === 'x'
        ? port.point.x === (forward ? from.right : from.left) && port.direction === 0
        : port.point.y === (forward ? from.bottom : from.top) && port.direction === 1);
      const b = ends.find(port => axis === 'x'
        ? port.point.x === (forward ? to.left : to.right) && port.direction === 0
        : port.point.y === (forward ? to.top : to.bottom) && port.direction === 1);
      if (!a || !b) continue;
      const middle = (a.stub[axis] + b.stub[axis]) / 2;
      const path = axis === 'x'
        ? [a.stub, { x: middle, y: a.stub.y }, { x: middle, y: b.stub.y }, b.stub]
        : [a.stub, { x: a.stub.x, y: middle }, { x: b.stub.x, y: middle }, b.stub];
      if (pathClear(path)) return simplify([a.point, ...path, b.point]);
    }
    return null;
  }

  function laneRoute(from, to, starts, ends) {
    // Dragged/aligned rows are often a few pixels uneven. Move a candidate lane
    // just beyond the cards it meets, instead of exploring thousands of grid
    // intersections to discover the same gap. Each lane has at most four shifts.
    function freeLane(axis, value, low, high, direction) {
      for (let step = 0; step < 4; step++) {
        const a = axis === 'x' ? { x: value, y: low } : { x: low, y: value };
        const b = axis === 'x' ? { x: value, y: high } : { x: high, y: value };
        const hits = query(segmentBounds(a, b)).filter(rect => hitsRectangle(a, b, rect));
        if (!hits.length) return value;
        value = direction < 0 ? Math.min(...hits.map(rect => axis === 'x' ? rect.left : rect.top))
          : Math.max(...hits.map(rect => axis === 'x' ? rect.right : rect.bottom));
      }
      return value;
    }
    let best = null, bestCost = Infinity;
    for (const start of starts) for (const end of ends) {
      if (start.direction === end.direction) continue;
      const a = start.stub, b = end.stub;
      let x, y;
      if (start.direction === 0) {
        x = freeLane('x', a.x, a.y, b.y, start.point.x === from.left ? -1 : 1);
        y = freeLane('y', b.y, x, b.x, end.point.y === to.top ? -1 : 1);
      } else {
        y = freeLane('y', a.y, a.x, b.x, start.point.y === from.top ? -1 : 1);
        x = freeLane('x', b.x, y, b.y, end.point.x === to.left ? -1 : 1);
      }
      const middle = start.direction === 0
        ? [a, { x, y: a.y }, { x, y }, { x: b.x, y }, b]
        : [a, { x: a.x, y }, { x, y }, { x, y: b.y }, b];
      const full = simplify([start.point, ...middle, end.point]);
      const cost = full.slice(1).reduce((sum, p, i) => sum + distance(p, full[i]), 0) + full.length * 8;
      if (cost < bestCost && pathClear(middle)) { best = full; bestCost = cost; }
    }
    return best;
  }

  function search(starts, ends) {
    // The compressed grid uses obstacle edges rather than pixel-sized cells.
    // Only visited states are allocated; maxSearch bounds pathological layouts.
    baseX ||= [...new Set(rectangles.flatMap(r => [r.left, r.right]).concat(outer.left, outer.right))].sort((a, b) => a - b);
    baseY ||= [...new Set(rectangles.flatMap(r => [r.top, r.bottom]).concat(outer.top, outer.bottom))].sort((a, b) => a - b);
    const ports = [...starts, ...ends];
    const xs = [...new Set(baseX.concat(ports.map(p => p.stub.x)))].sort((a, b) => a - b);
    const ys = [...new Set(baseY.concat(ports.map(p => p.stub.y)))].sort((a, b) => a - b);
    const xIndex = new Map(xs.map((v, i) => [v, i])), yIndex = new Map(ys.map((v, i) => [v, i]));
    const key = (x, y, direction) => (y * xs.length + x) * 2 + direction;
    const endByCell = new Map(ends.map(port => [yIndex.get(port.stub.y) * xs.length + xIndex.get(port.stub.x), port]));
    const heap = new MinHeap(), records = new Map(), edgeCache = new Map();
    const estimate = point => Math.min(...ends.map(port => distance(point, port.stub) + distance(port.stub, port.point)));
    for (const port of starts) {
      const x = xIndex.get(port.stub.x), y = yIndex.get(port.stub.y), id = key(x, y, port.direction);
      const cost = distance(port.point, port.stub) + port.penalty;
      const entry = { id, x, y, direction: port.direction, cost, priority: cost + estimate(port.stub), parent: null, port };
      records.set(id, entry); heap.push(entry);
    }
    let visited = 0;
    while (heap.items.length && visited++ < maxSearch) {
      const current = heap.pop();
      if (records.get(current.id) !== current) continue;
      const end = endByCell.get(current.y * xs.length + current.x);
      if (end) {
        const points = [end.point]; let entry = current;
        while (entry) {
          points.push({ x: xs[entry.x], y: ys[entry.y] });
          if (!entry.parent) points.push(entry.port.point);
          entry = entry.parent;
        }
        return simplify(points.reverse());
      }
      const a = { x: xs[current.x], y: ys[current.y] };
      for (const [x, y, direction] of [[current.x - 1, current.y, 0], [current.x + 1, current.y, 0], [current.x, current.y - 1, 1], [current.x, current.y + 1, 1]]) {
        if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
        const b = { x: xs[x], y: ys[y] }, id = key(x, y, direction);
        const cost = current.cost + distance(a, b) + (direction !== current.direction ? 8 : 0);
        if (records.has(id) && records.get(id).cost <= cost) continue;
        const aCell = current.y * xs.length + current.x, bCell = y * xs.length + x;
        const edgeKey = aCell < bCell ? `${aCell}:${bCell}` : `${bCell}:${aCell}`;
        if (!edgeCache.has(edgeKey)) edgeCache.set(edgeKey, segmentClear(a, b));
        if (!edgeCache.get(edgeKey)) continue;
        const entry = { id, x, y, direction, cost, priority: cost + estimate(b), parent: current };
        records.set(id, entry); heap.push(entry);
      }
    }
    return null;
  }

  return {
    route(fromId, toId, { bow = 0, crystal = false } = {}) {
      const from = cards.get(fromId), to = cards.get(toId);
      if (!from || !to || fromId === toId) return null;
      const original = legacyRoute(from, to, width, height, columnGap, bow, crystal);
      const obstacles = [], seen = new Set();
      // Segment queries avoid checking every node inside a tall curve's entire
      // bounding box. A few blockers suffice to choose candidate detours; every
      // candidate is still validated against the complete spatial index.
      for (let i = 1; i < original.points.length && obstacles.length < 8; i++) {
        const a = original.points[i - 1], b = original.points[i];
        for (const rect of query(segmentBounds(a, b))) {
          if (seen.has(rect.id)) continue;
          const tested = rect.id === fromId || rect.id === toId ? cards.get(rect.id) : rect;
          if (hitsRectangle(a, b, tested)) { seen.add(rect.id); obstacles.push(rect); if (obstacles.length >= 8) break; }
        }
      }
      if (!obstacles.length) return original;
      const starts = ports(from, original.points[0]), ends = ports(to, original.points.at(-1));
      const surrounding = [expanded.get(fromId), expanded.get(toId), ...obstacles];
      const envelope = {
        left: Math.min(...surrounding.map(r => r.left)), top: Math.min(...surrounding.map(r => r.top)),
        right: Math.max(...surrounding.map(r => r.right)), bottom: Math.max(...surrounding.map(r => r.bottom)),
      };
      const points = starts.length && ends.length && (corridorRoute(from, to, starts, ends) || quickRoute(starts, ends, envelope) || laneRoute(from, to, starts, ends) || search(starts, ends) || quickRoute(starts, ends, outer));
      if (!points) return { ...original, blocked: true };
      const d = points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      return describe(d, points, true);
    },
  };
}
