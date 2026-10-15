// Anchor the visible block, so reflow from zooming does not restart reading.
export function captureReadingPosition(canvas) {
  const top = canvas.getBoundingClientRect().top;
  const range = canvas.scrollHeight - canvas.clientHeight;
  const fallback = { progress: range > 0 ? canvas.scrollTop / range : 0 };
  if (!canvas.scrollTop) return fallback;
  const candidates = canvas.querySelectorAll('#protection:not([hidden]), #frontmatter-info:not([hidden]), .tiptap > *');
  for (const node of candidates) {
    const rect = node.getBoundingClientRect();
    if (rect.height && rect.bottom > top) return {
      ...fallback, node, fraction: Math.max(0, (top - rect.top) / rect.height), gap: Math.max(0, rect.top - top),
    };
  }
  return fallback;
}

export function restoreReadingPosition(canvas, position) {
  if (position?.node?.isConnected) {
    const rect = position.node.getBoundingClientRect();
    canvas.scrollTo({ top: canvas.scrollTop + rect.top + rect.height * position.fraction - canvas.getBoundingClientRect().top - position.gap, behavior: 'instant' });
  } else canvas.scrollTo({ top: (position?.progress || 0) * Math.max(0, canvas.scrollHeight - canvas.clientHeight), behavior: 'instant' });
}
