import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const helper = () => import('../src/mindmap-appearance.mjs');
const makeCard = t => {
  const dom = new JSDOM('<!doctype html><div class="mindmap-node" data-node-card="root"><button class="mindmap-node-button"><span class="mindmap-node-title">Node</span></button><button class="mindmap-file">★</button></div>');
  t.after(() => dom.window.close());
  return { dom, card: dom.window.document.querySelector('.mindmap-node') };
};
const luminance = hex => {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};

test('appearance applies safe normalized styles without mutating a node or changing geometry', async t => {
  const { applyNodeAppearance } = await helper(); const { card } = makeCard(t);
  card.style.cssText = 'left:12px;top:34px;width:216px;height:96px';
  const input = Object.freeze({ background: '#AABBCC', style: 'note', color: '#FF0000' });
  applyNodeAppearance(card, input);
  assert.equal(card.dataset.nodeStyle, 'note'); assert.equal(card.dataset.nodeBackground, '#aabbcc');
  assert.equal(card.style.getPropertyValue('--mindmap-node-background'), '#aabbcc');
  assert.equal(card.style.getPropertyValue('--mindmap-node-text'), '#ff0000');
  assert.equal(card.style.getPropertyValue('--mindmap-node-foreground'), '#000000');
  assert.deepEqual([card.style.left, card.style.top, card.style.width, card.style.height], ['12px', '34px', '216px', '96px']);
  assert.deepEqual(input, { background: '#AABBCC', style: 'note', color: '#FF0000' });
});

test('custom backgrounds select a black or white default foreground with readable contrast', async t => {
  const { applyNodeAppearance } = await helper(); const { card } = makeCard(t);
  for (const red of [0, 64, 128, 192, 255]) for (const green of [0, 64, 128, 192, 255]) for (const blue of [0, 64, 128, 192, 255]) {
    const background = '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
    applyNodeAppearance(card, { background });
    const foreground = card.style.getPropertyValue('--mindmap-node-foreground');
    assert.ok(['#000000', '#ffffff'].includes(foreground));
    const a = luminance(background), b = luminance(foreground);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${background} / ${foreground}`);
    assert.equal(card.style.getPropertyValue('--mindmap-node-text'), '', 'automatic foreground is inherited unless text color is explicit');
  }
  applyNodeAppearance(card, { background: '#000000', color: '#123456' });
  assert.equal(card.style.getPropertyValue('--mindmap-node-foreground'), '#ffffff', 'attachment icons retain contrast independently of explicit text color');
  assert.equal(card.style.getPropertyValue('--mindmap-node-text'), '#123456');
});

test('resetting or rejecting appearance clears stale styling while retaining unrelated card state', async t => {
  const { applyNodeAppearance } = await helper(); const { card } = makeCard(t);
  card.classList.add('mindmap-selected'); card.style.left = '42px';
  for (const next of [{}, { background: 'url(https://example.com)', style: 'note capsule', color: '#112233;display:none' }, { background: '#123456\n', color: '#123456\r' }, null]) {
    applyNodeAppearance(card, { background: '#ffffff', style: 'double', color: '#e02020' }); applyNodeAppearance(card, next);
    assert.equal(card.hasAttribute('data-node-background'), false); assert.equal(card.hasAttribute('data-node-style'), false);
    for (const name of ['--mindmap-node-background', '--mindmap-node-foreground', '--mindmap-node-text']) assert.equal(card.style.getPropertyValue(name), '');
    assert.equal(card.dataset.nodeCard, 'root'); assert.equal(card.classList.contains('mindmap-selected'), true); assert.equal(card.style.left, '42px');
  }
});

test('all five styles retain the actual base card dimensions and absent styling retains the legacy appearance', async t => {
  const { applyNodeAppearance } = await helper(); const { dom, card } = makeCard(t);
  const style = dom.window.document.createElement('style');
  style.textContent = await readFile(new URL('../src/mindmap.css', import.meta.url), 'utf8'); dom.window.document.head.append(style);
  const base = dom.window.getComputedStyle(card);
  const legacy = { width: base.width, height: base.height, radius: base.borderRadius, border: base.borderStyle };
  const appearances = dom.window.document.createElement('style'); appearances.textContent = await readFile(new URL('../src/mindmap-appearance.css', import.meta.url), 'utf8'); dom.window.document.head.append(appearances);
  applyNodeAppearance(card, {});
  const unchanged = dom.window.getComputedStyle(card);
  assert.deepEqual({ width: unchanged.width, height: unchanged.height, radius: unchanged.borderRadius, border: unchanged.borderStyle }, legacy);
  const radii = new Set();
  for (const appearance of ['plain', 'rounded', 'note', 'capsule', 'double']) {
    applyNodeAppearance(card, { style: appearance }); const computed = dom.window.getComputedStyle(card);
    assert.equal(computed.width, '216px'); assert.equal(computed.height, '96px'); radii.add(computed.borderRadius);
    if (appearance === 'double') assert.equal(computed.borderStyle, 'double');
  }
  assert.ok(radii.size >= 3, 'the shape choices visibly differ');
});
