import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { safeLink } from './document.mjs';
import { t, onLocaleChange } from './i18n.mjs';

const lowlight = createLowlight(common);

export function createEditor(element, markdown = '', options = {}) {
  const MarkdownImage = Image.extend({
    renderMarkdown(node) {
      const alt = (node.attrs.alt || '').replace(/[\\\[\]]/g, '\\$&');
      const src = (node.attrs.src || '').replace(/[\s()<>"\\]/g, character => encodeURIComponent(character));
      const title = node.attrs.title ? ` "${node.attrs.title.replace(/[\\"]/g, '\\$&')}"` : '';
      return `![${alt}](${src}${title})`;
    }
  });
  const ImageExtension = options.imageURL ? MarkdownImage.extend({
    addNodeView() {
      return ({ node }) => {
        const figure = document.createElement('figure'); figure.contentEditable = 'false';
        const img = document.createElement('img');
        const caption = document.createElement('span'); caption.className = 'image-error'; caption.textContent = t('图片无法读取');
        figure.append(img, caption);
        const render = current => {
          img.src = options.imageURL(current.attrs.src);
          img.alt = current.attrs.alt || ''; img.title = current.attrs.title || '';
          figure.classList.remove('missing');
        };
        img.addEventListener('error', () => figure.classList.add('missing'));
        img.addEventListener('load', () => figure.classList.remove('missing'));
        render(node);
        return { dom: figure, update(next) { if (next.type.name !== 'image') return false; render(next); return true; } };
      };
    }
  }) : MarkdownImage;
  const editor = new Editor({
    element,
    editable: options.editable ?? true,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: false, isAllowedUri: url => safeLink(url) } }),
      CodeBlockLowlight.configure({ lowlight }),
      TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }),
      ImageExtension.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: () => t('写下你的第一句话…') }),
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: markdown.replace(/^\ufeff/, ''), contentType: 'markdown',
    editorProps: { attributes: () => ({ 'aria-label': t('文档正文'), spellcheck: 'false' }) },
    ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
    ...(options.onSelectionUpdate ? { onSelectionUpdate: options.onSelectionUpdate } : {}),
  });
  const unsubscribeLocale = onLocaleChange(() => {
    if (editor.isDestroyed) return;
    // Updating labels in place also leaves an active IME composition untouched.
    // Dynamic extension attributes supply the current language on future renders.
    editor.view.dom.setAttribute('aria-label', t('文档正文'));
    for (const placeholder of editor.view.dom.querySelectorAll('[data-placeholder]')) placeholder.setAttribute('data-placeholder', t('写下你的第一句话…'));
    for (const caption of editor.view.dom.querySelectorAll('.image-error')) caption.textContent = t('图片无法读取');
  });
  editor.on('destroy', unsubscribeLocale);
  return editor;
}
