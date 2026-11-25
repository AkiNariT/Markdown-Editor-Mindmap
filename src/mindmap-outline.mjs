import { marked, Tokenizer } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
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

const encoder = new TextEncoder();
const digest = text => bytesToHex(sha256(encoder.encode(text)));
const namedPath = path => JSON.stringify(path.map(({ level, text }) => [level, text]));

function documentHeadings(text, anchors = false) {
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
  const headings = withHeadingPaths(tokens.filter(token => token.type === 'heading').map(token => ({
    depth: token.depth, text: visibleText(token.tokens || []).trim(), start: token.start, end: token.start + token.raw.trimEnd().length,
  })));
  if (!anchors) return headings;
  const documentHash = digest(source), groups = new Map(), copies = new Map(), parents = [];
  let previousStart = 0, line = 1;
  for (const heading of headings) {
    heading.key = namedPath(heading.path);
    groups.set(heading.key, (groups.get(heading.key) || 0) + 1);
    while (parents.length && parents.at(-1).depth >= heading.depth) parents.pop().sectionEnd = heading.start;
    parents.push(heading);
    for (let i = previousStart; i < heading.start; i++) if (source.charCodeAt(i) === 10) line++;
    heading.line = line; previousStart = heading.start;
  }
  for (const heading of headings) {
    const section = source.slice(heading.end, heading.sectionEnd ?? source.length).trim();
    heading.anchor = { document: documentHash, section: digest(section), count: groups.get(heading.key) };
    const key = heading.key + heading.anchor.section;
    copies.set(key, (copies.get(key) || 0) + 1);
    heading.preview = section.slice(0, 120).split('\n')[0].trim();
  }
  for (const heading of headings) heading.anchor.copies = copies.get(heading.key + heading.anchor.section);
  return headings;
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

export function resolveHeadingLink(text, { headingPath, headingAnchor }) {
  const headings = documentHeadings(text, true);
  const key = namedPath(headingPath), candidates = headings.filter(h => h.key === key);
  const exact = candidates.find(h => matchesPath(h, headingPath));
  if (headingAnchor && exact && headingAnchor.document === exact.anchor.document) return { headings, target: exact, candidates };
  const matching = headingAnchor ? candidates.filter(h => h.anchor.section === headingAnchor.section) : [];
  let target;
  if (headingAnchor?.copies === 1 && matching.length === 1) target = matching[0];
  else if (candidates.length === 1 && (headingAnchor ? headingAnchor.count === 1 : headingPath.every(part => part.occurrence === 1))) target = candidates[0];
  return { headings, target, candidates };
}

export function findRenderedHeading(editorRoot, path, markdown) {
  const parsed = documentHeadings(markdown), target = parsed.find(heading => matchesPath(heading, path));
  return renderedHeadingElement(editorRoot, parsed, target);
}
export function renderedHeadingElement(editorRoot, parsed, target) {
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
  return withHeadingPaths(headings).find(heading => matchesPath(heading, target.path))?.element;
}

export function markdownToMindmap(text, { title, file = null } = {}) {
  const headings = documentHeadings(text, Boolean(file));
  if (!headings.length) throw new Error(t('文档中没有可转换的标题，请先添加 Markdown 标题。'));
  const firstIsRoot = headings[0].depth === 1 && headings.filter(heading => heading.depth === 1).length === 1;
  const nodes = [], ids = [];
  if (!firstIsRoot) nodes.push({ id: 'root', parent: null, text: (typeof title === 'string' && title.trim()) || t('文档大纲'), file, collapsed: false });
  for (const heading of headings) {
    const root = firstIsRoot && heading.index === 0, id = root ? 'root' : `heading-${nodes.length}`;
    ids.push(id);
    nodes.push({ id, parent: root ? null : ids[heading.parent] || 'root', text: heading.text, file, collapsed: false,
      ...(file ? { headingPath: heading.path, headingAnchor: heading.anchor } : {}) });
  }
  return validateMindmap({ format: 'md-mindmap', version: file ? 7 : 6, root: 'root', nodes, connections: [] });
}
