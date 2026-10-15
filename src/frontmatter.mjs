import { t } from './i18n.mjs';
import { parseDocument, isMap, isScalar, CST } from 'yaml';

function parseHeader(markdown) {
  const opening = /^\ufeff?---[ \t]*\r?\n/.exec(markdown);
  if (!opening) return null;
  const rest = markdown.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return null;
  const yaml = rest.slice(0, closing.index);
  let document;
  try { document = parseDocument(yaml, { keepSourceTokens: true, logLevel: 'silent' }); }
  catch { return null; }
  if (document.errors.length) return null;
  const headerEnd = opening[0].length + closing.index + closing[0].length;
  const gap = /^(?:[ \t]*\r?\n)*/.exec(markdown.slice(headerEnd))[0];
  const prefixEnd = headerEnd + gap.length;
  const nodes = isMap(document.contents) ? ['name', 'description'].map(key => document.get(key, true)) : [];
  const editable = nodes.length === 2 && nodes.every(node => isScalar(node) && typeof node.value === 'string' && !node.anchor && !node.tag && node.srcToken && node.range);
  return { prefix: markdown.slice(0, prefixEnd), body: markdown.slice(prefixEnd), yaml, openingLength: opening[0].length,
    skill: editable ? { name: nodes[0].value, description: nodes[1].value } : null, nodes };
}

export function splitFrontmatter(markdown) {
  const parsed = parseHeader(markdown);
  if (!parsed) return null;
  const { nodes, ...parts } = parsed;
  return parts;
}

export function validateSkillFields({ name, description }) {
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(t('技能名称需使用小写英文、数字及连字符，最长 64 个字符。'));
  if (typeof description !== 'string' || !description.trim() || description.length > 1024 || /[<>]/.test(description)) throw new Error(t('用途与触发条件不能为空，最长 1024 个字符，不能包含 < 或 >。'));
}

export function composeMarkdown(body, original = '', values, { validate = true } = {}) {
  const parts = parseHeader(original);
  let prefix = parts?.prefix || '';
  if (parts?.skill && values) {
    if (validate) validateSkillFields(values);
    const patches = [];
    for (const [index, key] of ['name', 'description'].entries()) {
      const node = parts.nodes[index];
      if (values[key] === node.value) continue;
      const token = node.srcToken;
      CST.setScalarValue(token, values[key], { type: 'QUOTE_DOUBLE', afterKey: true });
      const replacement = CST.stringify(token).replace(/\r?\n/g, parts.yaml.includes('\r\n') ? '\r\n' : '\n');
      patches.push({ start: parts.openingLength + node.range[0], end: parts.openingLength + node.range[2], text: replacement });
    }
    for (const patch of patches.sort((a, b) => b.start - a.start)) prefix = prefix.slice(0, patch.start) + patch.text + prefix.slice(patch.end);
    const checked = splitFrontmatter(prefix + parts.body);
    if (!checked?.skill || checked.skill.name !== values.name || checked.skill.description !== values.description) throw new Error(t('文件头信息未能安全更新，未保存修改。'));
  }
  let text = body.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\n*$/, '') + '\n';
  if (original.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  if (parts && !prefix.endsWith('\n')) prefix += original.includes('\r\n') ? '\r\n\r\n' : '\n\n';
  return parts ? prefix + text : (original.startsWith('\ufeff') ? '\ufeff' : '') + text;
}
