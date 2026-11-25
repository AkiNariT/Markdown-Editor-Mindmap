import { t } from './i18n.mjs';
import path from 'node:path';
import { imageDestinations, rewriteImageDestinations } from './markdown-image-paths.mjs';
export { imageDestinations, rewriteImageDestinations };

export function rebaseImages(content, oldBase, newBase, rebased = new Map()) {
  if (path.resolve(oldBase).toLowerCase() === path.resolve(newBase).toLowerCase()) return content;
  for (const href of imageDestinations(content)) {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;
    let source;
    try { source = decodeURIComponent(href); } catch { throw new Error(t('图片路径包含无效编码，请先检查图片链接。')); }
    const relative = path.relative(newBase, path.resolve(oldBase, source)).replace(/\\/g, '/');
    const destination = relative.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
    if (destination !== href) rebased.set(href, destination);
  }
  return rewriteImageDestinations(content, rebased);
}
