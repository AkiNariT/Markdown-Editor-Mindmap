import { marked } from 'marked';

export function imageDestinations(content) {
  const destinations = new Set();
  marked.walkTokens(marked.lexer(content), token => { if (token.type === 'image') destinations.add(token.href); });
  return [...destinations];
}

export function rewriteImageDestinations(content, replacements, onEdit) {
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
  for (const edit of edits) if (actualDestinations.has(edit.probeHref)) {
    const from = originalOffset(edit.from), to = originalOffset(edit.to);
    result = result.slice(0, from) + edit.text + result.slice(to);
    onEdit?.(from, to, edit.text.length);
  }
  return result;
}
