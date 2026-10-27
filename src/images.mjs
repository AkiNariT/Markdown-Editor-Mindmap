import { t } from './i18n.mjs';
import path from 'node:path';
import { marked } from 'marked';

export function rebaseImages(content, oldBase, newBase) {
  if (path.resolve(oldBase).toLowerCase() === path.resolve(newBase).toLowerCase()) return content;
  const rebased = new Map();
  for (const href of imageDestinations(content)) {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;
    let source;
    try { source = decodeURIComponent(href); } catch { throw new Error(t('图片路径包含无效编码，请先检查图片链接。')); }
    const relative = path.relative(newBase, path.resolve(oldBase, source)).replace(/\\/g, '/');
    rebased.set(href, relative.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/'));
  }
  return rewriteImageDestinations(content, rebased);
}

export function imageDestinations(content) {
  const destinations = new Set();
  marked.walkTokens(marked.lexer(content), token => { if (token.type === 'image') destinations.add(token.href); });
  return [...destinations];
}

export function rewriteImageDestinations(content, replacements) {
  if (!replacements.size) return content;
  const original = content, crlf = [];
  for (const match of content.matchAll(/\r\n/g)) crlf.push(match.index - crlf.length);
  content = content.replace(/\r\n?/g, '\n');
  const originalOffset = offset => {
    let low = 0, high = crlf.length;
    while (low < high) { const middle = (low + high) >>> 1; if (crlf[middle] < offset) low = middle + 1; else high = middle; }
    return offset + low;
  };
  const candidates = new Map();
  let marker = '-md-image-rewrite-';
  while (content.includes(marker)) marker += 'x';
  for (const href of imageDestinations(content)) {
    if (!href || !replacements.has(href)) continue;
    // Marked removes Markdown punctuation escapes from hrefs. Match either
    // source spelling, retaining the exact original range for the final edit.
    const rawHref = [...href].map(character => {
      const escaped = character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(character) ? '(?:\\\\)?' + escaped : escaped;
    }).join('');
    const patterns = [
      new RegExp('(\\]\\([ \\t\\n>]*<?)(' + rawHref + ')(?=[ \\t\\n)>]|$)', 'g'),
      new RegExp('(\\[(?:\\\\.|[^\\]\\\\])+\\]:[ \\t]*(?:\\n[ \\t>]*?)?<?)(' + rawHref + ')(?=[ \\t\\n>]|$)', 'g'),
    ];
    for (const pattern of patterns) for (const match of content.matchAll(pattern)) {
      const from = match.index + match[1].length, to = from + match[2].length;
      if (candidates.has(from)) continue;
      const suffix = marker + candidates.size;
      candidates.set(from, { from, to, text: replacements.get(href), suffix, probeHref: href + suffix });
    }
  }
  const edits = [...candidates.values()].sort((a, b) => b.from - a.from);
  let probe = content;
  for (const edit of edits) probe = probe.slice(0, edit.to) + edit.suffix + probe.slice(edit.to);
  // The parser decides which source occurrences are actual image destinations.
  // This excludes escaped text, titles, HTML, fenced/inline code and unused or
  // shadowed reference definitions, including inside lists and block quotes.
  const actualDestinations = new Set(imageDestinations(probe));
  let result = original;
  for (const edit of edits) if (actualDestinations.has(edit.probeHref)) result = result.slice(0, originalOffset(edit.from)) + edit.text + result.slice(originalOffset(edit.to));
  return result;
}
