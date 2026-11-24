import { findMarkdownHeading, findRenderedHeading } from './mindmap-outline.mjs';

let clearHighlight;

export function revealLinkedHeading({ path, markdown, view, editorRoot, source }) {
  clearHighlight?.();
  const rendered = view !== 'source' && findRenderedHeading(editorRoot, path, markdown);
  const heading = view !== 'render' && findMarkdownHeading(markdown, path);
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
    const line = markdown.slice(0, heading.start).split('\n').length - 1;
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
