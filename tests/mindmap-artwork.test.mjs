import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as themes from '../src/mindmap-themes.mjs';

// Sample the actual emitted M/L/Q outline, then use an independent ray test.
// A proportional stretch of the old 96px artwork fails the text-area checks.
function polygon(d) {
  const tokens = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g), points = [];
  let current;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'Z') break;
    const next = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
    if (command === 'M' || command === 'L') { current = next; points.push(current); }
    else if (command === 'Q') {
      const end = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      for (let step = 1; step <= 64; step++) {
        const t = step / 64, u = 1 - t;
        points.push({ x: u * u * current.x + 2 * u * t * next.x + t * t * end.x,
          y: u * u * current.y + 2 * u * t * next.y + t * t * end.y });
      }
      current = end;
    } else throw new Error('Unsupported test path command ' + command);
  }
  return points;
}
function inside(points, x, y) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

test('dynamic artwork uses the real card coordinates instead of stretching the original viewBox', () => {
  const { document } = new JSDOM().window;
  const art = themes.createNodeArtwork(document, 'crystal', { width: 320, height: 1324 });
  assert.equal(art.getAttribute('viewBox'), '0 0 320 1324');
  assert.equal(art.querySelector('.mindmap-node-outline').getAttribute('transform'), null);
});

test('all decorative backgrounds contain the complete fixed-padding text area for compact, standard and wide tall cards', () => {
  assert.equal(typeof themes.nodeArtworkPaths, 'function');
  for (const theme of ['tree', 'vine', 'crystal']) {
    for (const width of [180, 216, 320]) for (const height of [96, 300, 680, 1324, 3000]) {
      const [outline, detail] = themes.nodeArtworkPaths(theme, width, height);
      assert.ok(detail && !/NaN|Infinity/.test(outline + detail));
      const points = polygon(outline);
      for (const x of [32, width / 2, width - 32]) for (const y of [18, 41, height / 2, height - 41, height - 18]) {
        assert.ok(inside(points, x, y), `${theme} ${width}×${height}: text point ${x},${y} must stay on the painted background`);
      }
    }
  }
});

test('default artwork keeps its original silhouette and plain themes need no SVG layer', () => {
  assert.equal(typeof themes.nodeArtworkPaths, 'function');
  assert.equal(themes.nodeArtworkPaths('crystal')[0], 'M 24 3 L 190 3 L 213 24 L 213 72 L 191 93 L 24 93 L 3 72 L 3 24 Z');
  assert.equal(themes.nodeArtworkPaths('tree')[0], 'M 18 4 Q 73 0 126 4 L 192 3 Q 211 4 213 21 L 211 70 Q 214 90 195 92 L 124 90 Q 67 96 19 91 Q 3 90 4 73 L 2 25 Q 2 7 18 4 Z');
  for (const theme of ['classic', 'rounded', 'capsule', 'unknown', '__proto__']) assert.equal(themes.nodeArtworkPaths(theme), null);
});
