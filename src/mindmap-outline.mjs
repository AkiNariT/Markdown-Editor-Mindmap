import { marked } from 'marked';
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

/** Extract a navigation tree only. Source Markdown is never rewritten, and
 * links are created only when the caller provides a real source file path. */
export function markdownToMindmap(text, { title, file = null } = {}) {
  if (typeof text !== 'string') throw new Error(t('Markdown 内容必须是文本。'));
  const content = splitFrontmatter(text)?.body ?? text;
  const headings = marked.lexer(content.replace(/^\ufeff/, '')).filter(token => token.type === 'heading')
    .map(token => ({ depth: token.depth, text: visibleText(token.tokens || []).trim() }));
  if (!headings.length) throw new Error(t('文档中没有可转换的标题，请先添加 Markdown 标题。'));
  const firstIsRoot = headings[0].depth === 1 && headings.filter(heading => heading.depth === 1).length === 1;
  const rootText = firstIsRoot ? headings.shift().text : (typeof title === 'string' && title.trim() ? title.trim() : t('文档大纲'));
  const nodes = [{ id: 'root', parent: null, text: rootText, file, collapsed: false }];
  const stack = [{ depth: firstIsRoot ? 1 : 0, id: 'root' }];
  for (const heading of headings) {
    while (stack.length > 1 && stack.at(-1).depth >= heading.depth) stack.pop();
    const id = `heading-${nodes.length}`;
    nodes.push({ id, parent: stack.at(-1).id, text: heading.text, file, collapsed: false });
    stack.push({ depth: heading.depth, id });
  }
  return validateMindmap({ format: 'md-mindmap', version: 6, root: 'root', nodes, connections: [] });
}
