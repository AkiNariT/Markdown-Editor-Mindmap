import { renderedHeadingElement } from './mindmap-outline.mjs';
import { t } from './i18n.mjs';

let clearHighlight;

export function clearLinkedHeading() { clearHighlight?.(); }

export async function chooseLinkedHeading(title, { headings, candidates }) {
  const dialog = document.getElementById('heading-choice'), select = document.getElementById('heading-options');
  const preview = document.getElementById('heading-choice-preview');
  const open = document.getElementById('heading-open'), bind = document.getElementById('heading-rebind');
  document.getElementById('heading-choice-note').textContent = t('无法确定“{title}”的位置。重新绑定后，请保存来源导图。', { title });
  const sameName = new Set(candidates);
  select.replaceChildren();
  function group(label, items) {
    if (!items.length) return;
    const group = document.createElement('optgroup'); group.label = label;
    for (const heading of items) {
      const option = document.createElement('option'); option.value = String(heading.index);
      option.textContent = t('第 {line} 行 · {path}', { line: heading.line, path: heading.path.map(p => p.text).join(' › ') });
      group.append(option);
    }
    select.append(group);
  }
  group(t('同名标题'), candidates);
  group(t('其他标题'), headings.filter(h => !sameName.has(h)));
  select.selectedIndex = -1;
  function update() {
    const selected = select.selectedIndex < 0 ? undefined : headings[Number(select.value)];
    preview.textContent = selected?.preview || '';
    open.disabled = !selected; bind.disabled = !selected;
  }
  update(); select.addEventListener('change', update);
  dialog.returnValue = '';
  const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  dialog.showModal(); select.focus(); await closed;
  select.removeEventListener('change', update);
  if (!['open', 'rebind'].includes(dialog.returnValue) || select.selectedIndex < 0) return null;
  return { target: headings[Number(select.value)], rebind: dialog.returnValue === 'rebind' };
}

export function revealLinkedHeading({ headings, target, markdown, view, editorRoot, source }) {
  clearHighlight?.();
  const rendered = view !== 'source' && renderedHeadingElement(editorRoot, headings, target);
  const heading = view !== 'render' && target;
  if (!rendered && !heading) return false;

  const cleanup = [];
  if (rendered) {
    rendered.scrollIntoView({ block: 'center', behavior: 'instant' });
    const range = document.createRange();
    range.selectNodeContents(rendered);
    CSS.highlights.set('md-linked-heading', new Highlight(range));
    cleanup.push(() => CSS.highlights.delete('md-linked-heading'));
  }
  if (heading) {
    // The source editor doesn't wrap lines. A temporary overlay highlights the
    // whole heading (including a Setext underline) without replacing the user's selection.
    const line = heading.line - 1;
    const lines = markdown.slice(heading.start, heading.end).split('\n').length;
    const style = getComputedStyle(source), lineHeight = parseFloat(style.lineHeight);
    const top = parseFloat(style.paddingTop) + line * lineHeight;
    source.scrollTop = Math.max(0, top - source.clientHeight / 3);
    source.scrollLeft = 0;
    const marker = document.createElement('div');
    marker.className = 'source-linked-heading'; marker.setAttribute('aria-hidden', 'true');
    marker.style.left = style.paddingLeft; marker.style.height = lines * lineHeight + 'px';
    const position = () => { marker.style.top = top - source.scrollTop + 'px'; };
    position(); source.parentElement.append(marker);
    source.addEventListener('scroll', position);
    cleanup.push(() => { source.removeEventListener('scroll', position); marker.remove(); });
  }
  const timer = setTimeout(() => clearHighlight?.(), 2200);
  clearHighlight = () => { clearTimeout(timer); for (const clear of cleanup) clear(); clearHighlight = undefined; };
  return true;
}
