import { t } from './i18n.mjs';
import path from 'node:path';
import { marked } from 'marked';

export function rebaseImages(content, oldBase, newBase, { platform = process.platform, pathApi = path } = {}) {
  const comparePath = value => platform === 'win32' ? value.toLowerCase() : value;
  if (comparePath(pathApi.resolve(oldBase)) === comparePath(pathApi.resolve(newBase))) return content;
  const tokens = marked.lexer(content), images = [], protectedRaw = [];
  marked.walkTokens(tokens, token => {
    if (token.type === 'image') images.push(token);
    if (token.type === 'code' || token.type === 'codespan') protectedRaw.push(token.raw);
  });
  const protectedRanges = [];
  for (const raw of protectedRaw) {
    let offset = 0, index;
    while (raw && (index = content.indexOf(raw, offset)) !== -1) { protectedRanges.push([index, index + raw.length]); offset = index + raw.length; }
  }
  const insideCode = (start, end) => protectedRanges.some(([a, b]) => a <= start && b >= end);
  const rebased = new Map();
  for (const token of images) {
    if (!token.href || /^[a-z][a-z0-9+.-]*:/i.test(token.href) || token.href.startsWith('//')) continue;
    let source;
    try { source = decodeURIComponent(token.href); } catch { throw new Error(t('图片路径包含无效编码，请先检查图片链接。')); }
    const relative = pathApi.relative(newBase, pathApi.resolve(oldBase, source)).replace(/\\/g, '/');
    rebased.set(token.href, relative.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/'));
  }
  const edits = new Map();
  for (const token of images) {
    if (!rebased.has(token.href)) continue;
    const opening = token.raw.lastIndexOf(']('); if (opening === -1) continue;
    let start = opening + 2; while (/\s/.test(token.raw[start])) start++;
    if (token.raw[start] === '<') start++;
    const destinationStart = token.raw.indexOf(token.href, start);
    if (destinationStart !== start) continue;
    let cursor = 0, index;
    while ((index = content.indexOf(token.raw, cursor)) !== -1) {
      const from = index + destinationStart, to = from + token.href.length;
      if (!insideCode(index, index + token.raw.length)) edits.set(from, { from, to, text: rebased.get(token.href) });
      cursor = index + token.raw.length;
    }
  }
  // Definitions can be shared by reference images; preserve their labels and titles.
  const definitions = /^([ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:\r?\n[ \t]*)?)(?:<([^>\n]+)>|([^\s]+))/gm;
  let match;
  while ((match = definitions.exec(content))) {
    const href = match[3] || match[4];
    const id = match[2].replace(/\s+/g, ' ').toLowerCase();
    if (!tokens.links[id] || !rebased.has(href) || insideCode(match.index, match.index + match[0].length)) continue;
    const from = match.index + match[1].length + (match[3] ? 1 : 0);
    edits.set(from, { from, to: from + href.length, text: rebased.get(href) });
  }
  for (const edit of [...edits.values()].sort((a, b) => b.from - a.from)) content = content.slice(0, edit.from) + edit.text + content.slice(edit.to);
  return content;
}
