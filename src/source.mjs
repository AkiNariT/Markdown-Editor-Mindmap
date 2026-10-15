import { t, onLocaleChange } from './i18n.mjs';

export function toSourceText(markdown) { return markdown.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n'); }
export function fromSourceText(text, original = '') {
  if (text === toSourceText(original)) return original;
  const newline = original.includes('\r\n') ? '\r\n' : original.includes('\r') && !original.includes('\n') ? '\r' : '\n';
  const body = text.replace(/\r\n?|\n/g, newline);
  return (original.startsWith('\ufeff') ? '\ufeff' : '') + body;
}

export function createSourceEditor(onInput) {
  const host = document.createElement('div'); host.className = 'source-panel';
  const header = document.createElement('div'); header.className = 'source-header';
  const label = document.createElement('span'); label.textContent = t('Markdown 源码');
  const position = document.createElement('span'); position.className = 'source-position';
  header.append(label, position);
  const body = document.createElement('div'); body.className = 'source-body';
  const gutter = document.createElement('pre'); gutter.className = 'source-gutter'; gutter.setAttribute('aria-hidden', 'true');
  const input = document.createElement('textarea'); input.className = 'source-input'; input.setAttribute('aria-label', t('Markdown 源码')); input.wrap = 'off'; input.spellcheck = false; input.readOnly = true; input.autocomplete = 'off';
  body.append(gutter, input); host.append(header, body);
  let lines = 0, context = { lossy: false }, visualComposing = false;
  const undoStack = [], redoStack = [];
  const lineHeight = () => parseFloat(getComputedStyle(input).lineHeight) || 24;
  const snapshot = () => ({ text: input.value, start: input.selectionStart, end: input.selectionEnd, scrollLine: input.scrollTop / lineHeight(), left: input.scrollLeft, context });
  let current = snapshot(), before, group, composing = false, compositionStart;
  function push(stack, value) {
    stack.push(value);
    let bytes = stack.reduce((total, item) => total + item.text.length * 2, 0);
    while (stack.length > 1 && (stack.length > 100 || bytes > 32 * 1024 * 1024)) bytes -= stack.shift().text.length * 2;
  }
  function restore(value) {
    context = value.context;
    input.value = value.text; input.setSelectionRange(value.start, value.end); input.scrollTop = value.scrollLine * lineHeight(); input.scrollLeft = value.left;
    current = snapshot(); before = group = undefined; refresh(); onInput(context);
  }
  function history(redo = false) {
    if (input.readOnly) return false;
    const stack = redo ? redoStack : undoStack, target = redo ? undoStack : redoStack;
    if (!stack.length) return false;
    push(target, snapshot()); restore(stack.pop()); return true;
  }
  function refresh() {
    const count = input.value.split('\n').length;
    if (count !== lines) { gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n'); lines = count; }
    gutter.style.transform = `translateY(${-input.scrollTop}px)`;
    const before = input.value.slice(0, input.selectionStart);
    position.textContent = t('{line} 行 · {column} 列', { line: before.split('\n').length, column: [...before.slice(before.lastIndexOf('\n') + 1)].length + 1 });
  }
  input.addEventListener('beforeinput', event => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); history(event.inputType === 'historyRedo'); return; }
    before = snapshot();
  });
  input.addEventListener('input', event => {
    const next = snapshot();
    if (next.text === current.text) { refresh(); return; }
    if (!composing && !event.isComposing) {
      const previous = before || current, time = performance.now(), kind = event.inputType;
      const join = group && time - group.time < 750 && group.kind === kind && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind) && previous.start === previous.end && previous.start === current.start && previous.end === current.end;
      if (!join) push(undoStack, previous);
      group = { time, kind }; redoStack.length = 0;
    }
    current = next; before = undefined; refresh(); onInput(context);
  });
  input.addEventListener('compositionstart', () => { composing = true; compositionStart = snapshot(); group = undefined; });
  input.addEventListener('compositionend', () => {
    composing = false;
    if (compositionStart && input.value !== compositionStart.text) { push(undoStack, compositionStart); redoStack.length = 0; }
    compositionStart = undefined; current = snapshot(); refresh(); onInput(context);
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.isComposing) {
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); history(key === 'y' || event.shiftKey); return; }
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) group = undefined;
  });
  input.addEventListener('blur', () => { group = undefined; });
  input.addEventListener('pointerdown', () => { group = undefined; });
  for (const event of ['scroll', 'click', 'keyup', 'select']) input.addEventListener(event, refresh);
  const unsubscribeLocale = onLocaleChange(() => {
    label.textContent = t('Markdown 源码'); input.setAttribute('aria-label', t('Markdown 源码')); refresh();
  });
  refresh();
  return { host, input, refresh,
    destroy: unsubscribeLocale,
    closeGroup: () => { if (!visualComposing) group = undefined; },
    beginVisualComposition: () => { group = undefined; visualComposing = true; },
    endVisualComposition: () => { visualComposing = false; if (group) group.time = performance.now(); },
    undo: () => history(), redo: () => history(true), getText: () => input.value, setText(text, options = {}) {
    const previous = snapshot(); context = options.context || context;
    if (input.value === text) { current = snapshot(); return; }
    const time = performance.now();
    if (options.record) {
      if (group?.kind !== 'visual' || (!visualComposing && time - group.time >= 750)) push(undoStack, previous);
      group = { kind: 'visual', time }; redoStack.length = 0;
    } else { undoStack.length = redoStack.length = 0; group = undefined; }
    input.value = text; input.setSelectionRange(Math.min(previous.start, text.length), Math.min(previous.end, text.length)); input.scrollTop = previous.scrollLine * lineHeight(); input.scrollLeft = previous.left;
    before = undefined; current = snapshot(); refresh();
  } };
}
