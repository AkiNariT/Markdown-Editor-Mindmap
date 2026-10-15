import { t } from './i18n.mjs';
import { marked } from 'marked';
import { splitFrontmatter } from './frontmatter.mjs';
export { splitFrontmatter, validateSkillFields } from './frontmatter.mjs';
export function detectUnsupported(markdown) {
  const header = splitFrontmatter(markdown);
  const original = (header ? header.body : markdown).replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
  const chunks = [], tokens = marked.lexer(original); let html = false, specialNote = false;
  marked.walkTokens(tokens, token => {
    if (token.type === 'html') html = true;
    if (token.type === 'text' && !token.tokens) chunks.push(token.text);
    if (token.type === 'blockquote' && /^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(token.raw)) specialNote = true;
  });
  const clean = chunks.join('\n');
  const reasons = [];
  if (!header && /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.test(original)) reasons.push(t('YAML 元数据'));
  if (html) reasons.push(t('HTML 内容或注释'));
  if (/\[\^[^\]]+\]/.test(clean) || Object.keys(tokens.links).some(key => key.startsWith('^'))) reasons.push(t('脚注'));
  if (/\$\$|(?<!\\)\$[^$\n]+\$|\\\[|\\\(/.test(clean)) reasons.push(t('数学公式'));
  if (specialNote) reasons.push(t('特殊提示块'));
  if (/\[TOC\]|\[\[[^\]\n]+\]\]/i.test(clean)) reasons.push(t('目录标记或双向链接'));
  return reasons;
}
export function safeLink(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return false;
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
export function prepareMarkdown(value, original = '') {
  let text = value.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\n*$/, '') + '\n';
  if (original.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  return (original.startsWith('\ufeff') ? '\ufeff' : '') + text;
}
