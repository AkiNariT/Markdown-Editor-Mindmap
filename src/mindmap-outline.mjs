import { marked, Tokenizer } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { splitFrontmatter } from './frontmatter.mjs';
import { validateMindmap } from './mindmap.mjs';
import { t } from './i18n.mjs';

function visibleText(tokens) {
  return tokens.map(token => {
    if (token.type === 'html') return '';
    if (token.type === 'br') return '\n';
    if (token.type === 'codespan') return token.text;
    if (token.tokens) return visibleText(token.tokens);
    // Markdown entity references require a semicolon; code spans stay literal.
    return decodeHTMLStrict(token.text ?? token.raw ?? '');
  }).join('');
}

function documentHeadings(text) {
  if (typeof text !== 'string') throw new Error(t('Markdown 内容必须是文本。'));
  // The textarea omits the BOM and normalizes newlines. Capture positions from
  // the lexer's remaining input; link definitions need not appear as tokens.
  const source = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const body = splitFrontmatter(source)?.body ?? source;
  class HeadingTokenizer extends Tokenizer {
    heading(remaining) { const token = super.heading(remaining); if (token) token.start = source.length - remaining.length; return token; }
    lheading(remaining) { const token = super.lheading(remaining); if (token) token.start = source.length - remaining.length; return token; }
  }
  const tokens = marked.lexer(body, { ...marked.defaults, tokenizer: new HeadingTokenizer() });
  return withHeadingPaths(tokens.filter(token => token.type === 'heading').map(token => ({
    depth: token.depth, text: visibleText(token.tokens || []).trim(), start: token.start, end: token.start + token.raw.trimEnd().length,
  })));
}

function withHeadingPaths(items) {
  const stack = [{ depth: 0, index: -1, path: [], counts: new Map() }];
  return items.map((item, index) => {
    const { depth, text } = item;
    while (stack.at(-1).depth >= depth) stack.pop();
    const parent = stack.at(-1), key = JSON.stringify([depth, text]);
    const occurrence = (parent.counts.get(key) || 0) + 1;
    parent.counts.set(key, occurrence);
    const path = [...parent.path, { level: depth, text, occurrence }];
    stack.push({ depth, index, path, counts: new Map() });
    return { ...item, path, parent: parent.index, index };
  });
}

function matchesPath(heading, path) {
  return heading.path.length === path.length && heading.path.every((part, i) =>
    part.level === path[i].level && part.text === path[i].text && part.occurrence === path[i].occurrence);
}
export function findMarkdownHeading(text, path) {
  return documentHeadings(text).find(heading => matchesPath(heading, path));
}

export function findRenderedHeading(editorRoot, path, markdown) {
  const parsed = documentHeadings(markdown), target = parsed.find(heading => matchesPath(heading, path));
  if (!target) return undefined;
  const elements = [...editorRoot.children].filter(el => /^H[1-6]$/.test(el.tagName));
  if (elements.length === parsed.length && parsed.every((heading, i) => heading.depth === Number(elements[i].tagName[1]))) {
    return elements[target.index];
  }
  // Extra rendered HTML headings can change the outline shape. Match visible
  // document content without ProseMirror caret helpers or image error captions.
  const headings = elements.map(element => {
    const copy = element.cloneNode(true);
    for (const helper of copy.querySelectorAll('.image-error,.ProseMirror-trailingBreak,.ProseMirror-separator,.ProseMirror-widget')) helper.remove();
    for (const child of copy.querySelectorAll('br,img')) child.replaceWith(child.tagName === 'BR' ? '\n' : child.alt);
    return { element, depth: Number(element.tagName[1]), text: copy.textContent.trim() };
  });
  return withHeadingPaths(headings).find(heading => matchesPath(heading, path))?.element;
}

export function markdownToMindmap(text, { title, file = null } = {}) {
  const headings = documentHeadings(text);
  if (!headings.length) throw new Error(t('文档中没有可转换的标题，请先添加 Markdown 标题。'));
  const firstIsRoot = headings[0].depth === 1 && headings.filter(heading => heading.depth === 1).length === 1;
  const nodes = [], ids = [];
  if (!firstIsRoot) nodes.push({ id: 'root', parent: null, text: (typeof title === 'string' && title.trim()) || t('文档大纲'), file, collapsed: false });
  for (const heading of headings) {
    const root = firstIsRoot && heading.index === 0, id = root ? 'root' : `heading-${nodes.length}`;
    ids.push(id);
    nodes.push({ id, parent: root ? null : ids[heading.parent] || 'root', text: heading.text, file, collapsed: false,
      ...(file ? { headingPath: heading.path } : {}) });
  }
  return validateMindmap({ format: 'md-mindmap', version: file ? 7 : 6, root: 'root', nodes, connections: [] });
}
