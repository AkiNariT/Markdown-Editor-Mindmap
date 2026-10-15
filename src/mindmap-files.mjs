import { t } from './i18n.mjs';
import path from 'node:path';
import { validateMindmap, serializeMindmap } from './mindmap.mjs';

export function resolveMindmapFiles(value, documentPath, pathApi = path) {
  const result = validateMindmap(value);
  for (const node of result.nodes) {
    if (node.file === null) continue;
    if (!documentPath && !pathApi.isAbsolute(node.file)) throw new Error(t('未保存的导图需要使用 Markdown 文件的绝对路径。'));
    node.file = documentPath ? pathApi.resolve(pathApi.dirname(documentPath), node.file) : pathApi.resolve(node.file);
  }
  return result;
}

export function serializeMindmapForPath(value, destinationPath, pathApi = path) {
  const result = validateMindmap(value);
  for (const node of result.nodes) {
    if (node.file === null) continue;
    if (!pathApi.isAbsolute(node.file)) throw new Error(t('保存导图时，关联 Markdown 文件必须使用绝对路径。'));
    const relative = pathApi.relative(pathApi.dirname(destinationPath), node.file);
    node.file = pathApi.isAbsolute(relative) ? node.file : relative.split(pathApi.sep).join('/');
  }
  return serializeMindmap(result);
}
