import { t } from './i18n.mjs';

const extensions = /\.(png|jpe?g|gif|webp)$/i;
const imageTypes = /^image\/(png|jpeg|gif|webp)$/i;
const draftImage = /^md-draft-image:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp)$/i;
const MiB = 1024 * 1024;

export function imageFilesFromTransfer(transfer) {
  const files = Array.from(transfer?.files || []);
  if (!files.length) {
    for (const item of Array.from(transfer?.items || [])) if (item.kind === 'file') {
      const file = item.getAsFile?.(); if (file) files.push(file);
    }
  }
  return files.filter(file => Object.prototype.toString.call(file) === '[object File]'
    && (/^image\//i.test(file.type) || (!file.type && extensions.test(file.name))));
}

export function protectTextInputImagePaste(event) {
  const input = event.target?.closest?.('input, textarea');
  if (!input || input.classList.contains('source-input') || event.clipboardData?.getData('text/plain')) return false;
  if (!imageFilesFromTransfer(event.clipboardData).length) return false;
  event.preventDefault();
  return true;
}

export async function readImagePayloads(files) {
  if (!files.length || files.length > 10) throw new Error(t('一次最多插入 10 张图片。'));
  let total = 0;
  for (const file of files) {
    if (!(imageTypes.test(file.type) || (!file.type && extensions.test(file.name)))) throw new Error(t('请选择 PNG、JPEG、GIF 或 WebP 图片。'));
    if (file.size > 20 * MiB) throw new Error(t('每张图片不能超过 20 MB。'));
    total += file.size;
  }
  if (total > 50 * MiB) throw new Error(t('一次插入的图片合计不能超过 50 MB。'));
  const payloads = [];
  for (const file of files) payloads.push({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  return payloads;
}

export function imageMarkdown(images, { before = '', after = '' } = {}) {
  const markup = images.map(({ src, alt = '' }) => {
    const label = alt.replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
    const destination = src.replace(/[\s()<>"\\]/g, character => encodeURIComponent(character).replace(/[()]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase()));
    return `![${label}](${destination})`;
  }).join('\n\n');
  // The visual editor uses block images. Keep pasted source images in their
  // own paragraphs, including repeated pastes and a caret within existing text.
  const leading = before ? '\n'.repeat(Math.max(0, 2 - before.match(/\n*$/)[0].length)) : '';
  const trailing = after ? '\n'.repeat(Math.max(0, 2 - after.match(/^\n*/)[0].length)) : '';
  return leading + markup + trailing;
}

export async function importAtTarget(target, { isCurrent, request, insert }) {
  const verify = () => { if (!isCurrent(target)) throw new Error(t('文档已切换或内容已变化，图片未插入，请重试。')); };
  verify();
  const result = await request();
  if (result?.error) throw new Error(result.error);
  if (result?.canceled) return false;
  verify();
  if (result?.documentId !== target.id) throw new Error(t('图片所属文档不匹配，请重试。'));
  const images = result.images || (result.src ? [{ src: result.src, alt: result.alt || '' }] : []);
  if (!Array.isArray(images) || !images.length || images.length > 10 || images.some(image => typeof image?.src !== 'string' || !image.src || typeof image.alt !== 'string')) {
    throw new Error(t('无法插入图片，请重试。'));
  }
  insert(images);
  return true;
}

export function imageURLForDocument(src, value) {
  if (typeof src !== 'string') return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (!draftImage.test(src) && (!value?.path || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//'))) return '';
  return value?.imageKey ? `moye-image://${value.imageKey}/${encodeURIComponent(src)}` : '';
}
