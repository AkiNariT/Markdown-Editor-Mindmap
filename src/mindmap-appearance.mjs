const styles = new Set(['plain', 'rounded', 'capsule']);
const safeColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;

function foregroundFor(background) {
  const channels = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
}

// Apply only validated paint values. Geometry, node data and selection classes
// belong to the view and are deliberately left untouched.
export function applyNodeAppearance(card, node) {
  const background = safeColor(node?.background), color = safeColor(node?.color);
  if (styles.has(node?.style)) card.dataset.nodeStyle = node.style;
  else delete card.dataset.nodeStyle;
  if (background) {
    card.dataset.nodeBackground = background;
    card.style.setProperty('--mindmap-node-background', background);
    card.style.setProperty('--mindmap-node-foreground', foregroundFor(background));
  } else {
    delete card.dataset.nodeBackground;
    card.style.removeProperty('--mindmap-node-background');
    card.style.removeProperty('--mindmap-node-foreground');
  }
  if (color) card.style.setProperty('--mindmap-node-text', color);
  else card.style.removeProperty('--mindmap-node-text');
}
