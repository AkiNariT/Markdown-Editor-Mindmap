import { t } from './i18n.mjs';
import { captureReadingPosition, restoreReadingPosition } from './zoom.mjs';

// Keep an offset every 128 hits. A one-letter search in a large document
// still has an exact count without allocating a DOM Range per occurrence.
export function indexFindMatches(blocks, query) {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const offsets = [];
  let count = 0;
  if (query) for (const block of blocks) {
    pattern.lastIndex = 0;
    let match, local = 0;
    while ((match = pattern.exec(block.text))) {
      if (local++ % 128 === 0) offsets.push({ index: count, block, from: match.index });
      count++;
    }
  }
  return { count, at(index) {
    if (!count) return null;
    index = ((index % count) + count) % count;
    let left = 0, right = offsets.length;
    while (left + 1 < right) {
      const mid = (left + right) >>> 1;
      if (offsets[mid].index <= index) left = mid; else right = mid;
    }
    const anchor = offsets[left];
    pattern.lastIndex = anchor.from;
    let match;
    for (let i = anchor.index; i <= index; i++) match = pattern.exec(anchor.block.text);
    return { block: anchor.block, from: match.index, to: pattern.lastIndex };
  } };
}

export function visualFindBlocks(root) {
  const blocks = [];
  for (const element of root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre')) {
    let block;
    function visit(node) {
      if (node.nodeType === 3 && node.data) {
        if (!block) { block = { text: '', runs: [] }; blocks.push(block); }
        block.runs.push({ start: block.text.length, node });
        block.text += node.data;
      } else if (node.nodeType === 1) {
        if (node.matches('br,img,figure,[contenteditable="false"],.image-error')) { block = null; return; }
        for (const child of node.childNodes) visit(child);
      }
    }
    for (const child of element.childNodes) visit(child);
  }
  return blocks;
}

export function visualMatchRange({ block, from, to }) {
  function runAt(offset) {
    let left = 0, right = block.runs.length;
    while (left + 1 < right) {
      const mid = (left + right) >>> 1;
      if (block.runs[mid].start <= offset) left = mid; else right = mid;
    }
    return block.runs[left];
  }
  const first = runAt(from), last = runAt(to - 1), range = first.node.ownerDocument.createRange();
  range.setStart(first.node, from - first.start);
  range.setEnd(last.node, to - last.start);
  return range;
}

// Textareas expose no DOM Range for their text. Measure the active line with
// the same font and tabs, leaving the user's actual selection and undo alone.
function showSourceHit(input, hit) {
  const doc = input.ownerDocument, style = getComputedStyle(input);
  const overlay = doc.createElement('div'), line = doc.createElement('span'), mark = doc.createElement('mark');
  overlay.className = 'find-source-overlay'; overlay.setAttribute('aria-hidden', 'true');
  line.className = 'find-source-line'; line.style.font = style.font; line.style.tabSize = style.tabSize;
  line.style.lineHeight = style.lineHeight; line.style.letterSpacing = style.letterSpacing;
  const { text } = hit.block;
  const start = hit.from ? text.lastIndexOf('\n', hit.from - 1) + 1 : 0;
  let lineNumber = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < start; i = text.indexOf('\n', i + 1)) lineNumber++;
  line.append(text.slice(start, hit.from), mark); mark.textContent = text.slice(hit.from, hit.to);
  overlay.append(line); input.parentElement.append(overlay);
  const padding = parseFloat(style.paddingLeft);
  const top = parseFloat(style.paddingTop) + lineNumber * parseFloat(style.lineHeight);
  overlay.style.width = input.clientWidth + 'px'; overlay.style.height = input.clientHeight + 'px';
  overlay.style.clipPath = 'inset(0 0 0 ' + padding + 'px)';
  function position() {
    line.style.left = (padding - input.scrollLeft) + 'px';
    line.style.top = (top - input.scrollTop) + 'px';
  }
  position();
  const x = padding + mark.offsetLeft, height = parseFloat(style.lineHeight);
  if (top < input.scrollTop || top + height > input.scrollTop + input.clientHeight) {
    input.scrollTop = top - (input.clientHeight - height) / 2;
  }
  if (x < input.scrollLeft + padding || x + mark.offsetWidth > input.scrollLeft + input.clientWidth) {
    input.scrollLeft = x - padding;
  }
  position(); input.addEventListener('scroll', position);
  return () => { input.removeEventListener('scroll', position); overlay.remove(); };
}

export function createDocumentFind({ document: doc, getSurface, canOpen, onOpen }) {
  const bar = doc.getElementById('find-bar'), input = doc.getElementById('find-query');
  const count = doc.getElementById('find-count'), previous = doc.getElementById('find-previous'), next = doc.getElementById('find-next');
  let session, clearHit, restoring = false, restoreFrame, layoutFrame;
  const zoom = canvas => parseFloat(getComputedStyle(canvas).getPropertyValue('--document-zoom')) || 1;
  function layoutChanged() {
    if (!session || layoutFrame !== undefined) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = undefined; if (session) select(); });
  }
  function status() {
    if (!session) return;
    const total = session.result?.count || 0;
    previous.disabled = next.disabled = !total;
    count.textContent = !input.value ? '' : total ? t('{index} / {count}', { index: session.index + 1, count: total }) : t('无匹配');
    doc.getElementById('find-scope').textContent = session.scope === 'source' ? t('源码') : t('正文');
  }
  function select() {
    clearHit?.(); clearHit = null;
    status();
    const match = session?.result?.at(session.index);
    if (!match) return;
    if (session.scope === 'source') { clearHit = showSourceHit(session.source, match); return; }
    const range = visualMatchRange(match);
    CSS.highlights.set('document-find-active', new Highlight(range));
    clearHit = () => CSS.highlights.delete('document-find-active');
    const rect = range.getBoundingClientRect(), viewport = session.canvas.getBoundingClientRect();
    if (rect.top < viewport.top || rect.bottom > viewport.bottom) {
      session.canvas.scrollBy({ top: rect.top - viewport.top - viewport.height / 2 + rect.height / 2, behavior: 'instant' });
    }
    // Wide tables and code blocks may scroll horizontally inside the canvas.
    const element = range.startContainer.parentElement.closest('pre,.tableWrapper');
    if (element && element.scrollWidth > element.clientWidth) {
      const bounds = element.getBoundingClientRect();
      if (rect.left < bounds.left || rect.right > bounds.right) {
        if (!session.horizontal.has(element)) session.horizontal.set(element, element.scrollLeft);
        element.scrollLeft += rect.left - bounds.left;
      }
    }
  }
  function search() {
    if (!session) return;
    session.result = indexFindMatches(session.blocks, input.value);
    session.index = 0; select();
  }
  function move(direction) {
    const total = session?.result?.count;
    if (total) { session.index = (session.index + direction + total) % total; select(); }
  }
  function open() {
    if (!canOpen()) return false;
    if (!session) {
      const surface = getSurface();
      if (!surface) return false;
      const { canvas, source, visual, scope } = surface;
      const active = doc.activeElement;
      const selection = doc.getSelection();
      const selected = selection.rangeCount && visual.contains(selection.anchorNode) && visual.contains(selection.focusNode)
        ? { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset } : null;
      const suggestion = scope === 'source' ? source.value.slice(source.selectionStart, Math.min(source.selectionEnd, source.selectionStart + 201))
        : selected ? selection.toString().slice(0, 201) : '';
      if (suggestion && suggestion.length <= 200 && !/[\r\n]/.test(suggestion)) input.value = suggestion;
      session = { ...surface, focus: active?.closest('#more-menu') ? doc.getElementById('more-toggle') : active, selected,
        top: canvas.scrollTop, left: canvas.scrollLeft, sourceTop: source.scrollTop, sourceLeft: source.scrollLeft,
        zoom: zoom(canvas), width: canvas.clientWidth, anchor: canvas.clientWidth ? captureReadingPosition(canvas) : null,
        horizontal: new Map(), blocks: scope === 'source' ? [{ text: source.value }] : visualFindBlocks(visual) };
      session.resize = new ResizeObserver(layoutChanged);
      session.resize.observe(canvas); session.resize.observe(source);
      bar.hidden = false; search();
    }
    onOpen(); input.focus({ preventScroll: true }); input.select(); return true;
  }
  function close({ focus = true, restore = true, clear = false } = {}) {
    if (clear) input.value = '';
    if (!session) return;
    const old = session;
    old.resize.disconnect(); cancelAnimationFrame(layoutFrame); layoutFrame = undefined;
    cancelAnimationFrame(restoreFrame); restoring = true;
    clearHit?.(); clearHit = null; session = null; bar.hidden = true;
    if (focus) {
      const target = old.focus?.isConnected && old.focus !== doc.body ? old.focus : old.scope === 'source' ? old.source : old.canvas;
      target.focus({ preventScroll: true });
      const s = old.selected;
      if (s?.anchor.isConnected && s.focus.isConnected) doc.getSelection().setBaseAndExtent(s.anchor, s.anchorOffset, s.focus, s.focusOffset);
    }
    if (restore) {
      const ratio = zoom(old.canvas) / old.zoom;
      old.canvas.scrollTo({ top: old.top, left: old.left * ratio, behavior: 'instant' });
      if (old.anchor && (ratio !== 1 || old.width !== old.canvas.clientWidth)) restoreReadingPosition(old.canvas, old.anchor);
      old.source.scrollTop = old.sourceTop * ratio; old.source.scrollLeft = old.sourceLeft * ratio;
      for (const [element, left] of old.horizontal) element.scrollLeft = left * ratio;
    }
    restoreFrame = requestAnimationFrame(() => { restoring = false; });
  }
  input.addEventListener('input', search);
  previous.addEventListener('click', () => { move(-1); input.focus(); });
  next.addEventListener('click', () => { move(1); input.focus(); });
  doc.getElementById('find-close').addEventListener('click', () => close());
  doc.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || doc.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      if (!open()) return;
    } else if (session && event.key === 'Escape') close();
    else if (session && event.target === input && event.key === 'Enter') move(event.shiftKey ? -1 : 1);
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  // Clicking a result to continue editing should keep it in view. Restoration
  // belongs to Escape or the close button, not a click into the document.
  doc.addEventListener('pointerdown', event => {
    if (session && !bar.contains(event.target) && (session.visual.contains(event.target) || event.target === session.source)) {
      close({ focus: false, restore: false });
    }
  }, true);
  return { open, close, layoutChanged, refreshLanguage: status, get active() { return Boolean(session); }, get moving() { return Boolean(session) || restoring; } };
}
