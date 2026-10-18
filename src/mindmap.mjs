import { t } from './i18n.mjs';
import { mapThemes } from './mindmap-themes.mjs';

const controlCharacters = /[\x00-\x1f\x7f-\x9f]/;
const labelLineBreaks = /[\u2028\u2029]/;
const nodeStyles = new Set(['plain', 'rounded', 'note', 'capsule', 'double']);
const validId = value => typeof value === 'string' && value.length > 0 && !controlCharacters.test(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validFile(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/\.(md|markdown)$/i.test(value) || controlCharacters.test(value)) return false;
  // A drive letter is the only permitted colon: URI schemes and NTFS streams
  // must never turn a node attachment into a different kind of resource.
  const withoutDrive = /^[a-z]:[\\/]/i.test(value) ? value.slice(2) : value;
  return !withoutDrive.includes(':') && !/^[\\/]{2}[?.][\\/]/.test(value);
}

export function createMindmap() {
  return { format: 'md-mindmap', version: 1, root: 'root', nodes: [{ id: 'root', parent: null, text: t('中心主题'), file: null, collapsed: false }] };
}

export function validateMindmap(value) {
  if (!isRecord(value) || value.format !== 'md-mindmap') throw new Error(t('不是有效的 MD 思维导图文件。'));
  if (![1, 2, 3, 4, 5, 6].includes(value.version)) throw new Error(t('暂不支持这个思维导图版本。'));
  if (Object.hasOwn(value, 'lineStyle') && (value.version < 6 || !['curve', 'orthogonal', 'straight'].includes(value.lineStyle))) throw new Error(t('连线样式无效，需要使用第 6 版格式与支持的样式。'));
  if (Object.hasOwn(value, 'nodeSize') && (value.version < 6 || !['compact', 'standard', 'wide'].includes(value.nodeSize))) throw new Error(t('节点尺寸无效，需要使用第 6 版格式与支持的尺寸。'));
  if (Object.hasOwn(value, 'theme') && (value.version < 5 || !mapThemes.includes(value.theme))) throw new Error(t('整图风格无效，需要使用第 5 版格式与支持的风格。'));
  if (value.version >= 2 && (!Array.isArray(value.connections) || value.connections.length > 2000)) throw new Error(t('思维导图连接数据无效，最多支持 2000 条关系线。'));
  if (value.version === 1 && Object.hasOwn(value, 'connections')) throw new Error(t('节点连接需要使用新版思维导图格式。'));
  if (!validId(value.root) || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 1000) throw new Error(t('思维导图必须有根节点，且最多支持 1000 个节点。'));
  const byId = new Map();
  const nodes = value.nodes.map(item => {
    if (!isRecord(item) || !validId(item.id) || (item.parent !== null && !validId(item.parent))) throw new Error(t('思维导图节点标识无效。'));
    if (byId.has(item.id)) throw new Error(t('思维导图包含重复的节点标识。'));
    if (typeof item.text !== 'string' || item.text.length > 500) throw new Error(t('节点文字最多支持 500 个字符。'));
    if (!validFile(item.file)) throw new Error(t('节点只能关联本地 .md 或 .markdown 文件，路径不能包含网址或控制字符。'));
    if (typeof item.collapsed !== 'boolean') throw new Error(t('节点折叠状态无效。'));
    const normalized = { id: item.id, parent: item.parent, text: item.text, file: item.file, collapsed: item.collapsed };
    if (Object.hasOwn(item, 'subtitle')) {
      if (value.version < 6 || typeof item.subtitle !== 'string' || item.subtitle.length > 500) throw new Error(t('节点副标题无效，需要使用第 6 版格式，且不超过 500 个字符。'));
      normalized.subtitle = item.subtitle;
    }
    if (Object.hasOwn(item, 'offset')) {
      if (value.version < 2 || !isRecord(item.offset) || ![item.offset.x, item.offset.y].every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 100000)) throw new Error(t('节点位置无效，坐标须为 -100000 到 100000 之间的有限数值。'));
      normalized.offset = { x: item.offset.x, y: item.offset.y };
    }
    if (Object.hasOwn(item, 'color')) {
      if (value.version < 3 || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error(t('节点文字颜色无效，需要使用新版格式与六位十六进制颜色。'));
      normalized.color = item.color.toLowerCase();
    }
    if (Object.hasOwn(item, 'background')) {
      if (value.version < 4 || typeof item.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.background)) throw new Error(t('节点背景颜色无效，需要使用第 4 版格式与六位十六进制颜色。'));
      normalized.background = item.background.toLowerCase();
    }
    if (Object.hasOwn(item, 'style')) {
      if (value.version < 4 || !nodeStyles.has(item.style)) throw new Error(t('节点样式无效，需要使用第 4 版格式与支持的样式。'));
      normalized.style = item.style;
    }
    byId.set(item.id, normalized);
    return normalized;
  });
  if (byId.get(value.root)?.parent !== null) throw new Error(t('思维导图的根节点无效。'));
  for (const item of nodes) {
    if (item.id !== value.root && (item.parent === null || !byId.has(item.parent))) throw new Error(t('思维导图包含孤立节点或多个根节点。'));
    let current = item, depth = 0;
    const visited = new Set();
    while (current) {
      if (visited.has(current.id)) throw new Error(t('思维导图节点之间不能形成循环。'));
      visited.add(current.id);
      if (++depth > 64) throw new Error(t('思维导图最多支持 64 层节点。'));
      current = current.parent === null ? null : byId.get(current.parent);
    }
  }
  const ids = new Set(), pairs = new Set();
  const connections = (value.connections || []).map(edge => {
    if (!isRecord(edge) || !validId(edge.id) || ids.has(edge.id) || !byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) throw new Error(t('关系线标识或连接节点无效，不能连接自身。'));
    const pair = JSON.stringify([edge.from, edge.to].sort());
    if (pairs.has(pair)) throw new Error(t('这两个节点之间已有连接。'));
    const normalized = { id: edge.id, from: edge.from, to: edge.to };
    if (Object.hasOwn(edge, 'label')) {
      if (value.version < 4 || typeof edge.label !== 'string' || edge.label.length > 200 || controlCharacters.test(edge.label) || labelLineBreaks.test(edge.label)) throw new Error(t('关系线文字无效，需要使用第 4 版格式，且为不超过 200 个字符的单行文本。'));
      normalized.label = edge.label;
    }
    if (Object.hasOwn(edge, 'style')) {
      if (value.version < 6 || !['solid', 'dashed'].includes(edge.style)) throw new Error(t('关系线样式无效，需要使用第 6 版格式与支持的样式。'));
      normalized.style = edge.style;
    }
    if (Object.hasOwn(edge, 'arrow')) {
      if (value.version < 6 || !['none', 'end', 'both'].includes(edge.arrow)) throw new Error(t('关系线箭头无效，需要使用第 6 版格式与支持的箭头。'));
      normalized.arrow = edge.arrow;
    }
    if (Object.hasOwn(edge, 'color')) {
      if (value.version < 6 || typeof edge.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(edge.color)) throw new Error(t('关系线颜色无效，需要使用第 6 版格式与六位十六进制颜色。'));
      normalized.color = edge.color.toLowerCase();
    }
    ids.add(edge.id); pairs.add(pair); return normalized;
  });
  return { format: 'md-mindmap', version: value.version, root: value.root, nodes, ...(value.version >= 2 ? { connections } : {}), ...(Object.hasOwn(value, 'theme') ? { theme: value.theme } : {}), ...(Object.hasOwn(value, 'lineStyle') ? { lineStyle: value.lineStyle } : {}), ...(Object.hasOwn(value, 'nodeSize') ? { nodeSize: value.nodeSize } : {}) };
}

export function parseMindmap(text) {
  if (typeof text !== 'string') throw new Error(t('思维导图内容必须是 JSON 文本。'));
  let value;
  try { value = JSON.parse(text.replace(/^\ufeff/, '')); }
  catch { throw new Error(t('思维导图 JSON 格式无效，未能打开。')); }
  return validateMindmap(value);
}

export function serializeMindmap(value) {
  return JSON.stringify(validateMindmap(value), null, 2) + '\n';
}
