import { Editor, Node, getMarkRange } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { safeLink } from './document.mjs';
import { t, onLocaleChange } from './i18n.mjs';
import { closeHistory } from '@tiptap/pm/history';

const lowlight = createLowlight(common);

const MarkdownCodeBlock = CodeBlockLowlight.extend({
  renderMarkdown(node, helpers) {
    const body = helpers.renderChildren(node.content || []);
    const language = node.attrs?.language || '';
    const marker = language.includes('`') ? '~' : '`';
    let length = 3;
    for (const run of body.matchAll(marker === '~' ? /~+/g : /`+/g)) {
      length = Math.max(length, run[0].length + 1);
    }
    const fence = marker.repeat(length);
    return [fence + language, body, fence].join('\n');
  },
});

const MarkdownParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    // Pasted and standalone images are blocks. Images inside prose stay inline.
    if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
      const [image] = helpers.parseInline(token.tokens);
      return helpers.createNode('image', image.attrs);
    }
    return this.parent(token, helpers);
  },
});

// Tiptap represents links as text marks, which cannot retain a link around an
// image when serializing Markdown. Keep the entire linked label as one node.
const ImageLink = Node.create({
  name: 'imageLink', group: 'inline', inline: true, content: 'inline*',
  addAttributes() { return { href: { default: '' }, title: { default: null } }; },
  parseHTML() {
    return [{ tag: 'a[href]', priority: 100, getAttrs: element => element.querySelector('img') ? {} : false }];
  },
  renderHTML({ HTMLAttributes }) {
    return safeLink(HTMLAttributes.href) ? ['a', HTMLAttributes, 0] : ['span', {}, 0];
  },
  renderMarkdown(node, helpers) {
    const { href, title } = node.attrs;
    const destination = /[\s()<>\\]/.test(href) ? '<' + href.replace(/[<>\\]/g, '\\$&') + '>' : href;
    return '[' + helpers.renderChildren(node.content || []) + '](' + destination + markdownTitle(title) + ')';
  },
});

const MarkdownLink = Link.extend({
  parseMarkdown(token, helpers) {
    const link = this.parent(token, helpers);
    return link.content.some(child => child.type === 'inlineImage')
      ? helpers.createNode('imageLink', link.attrs, link.content)
      : link;
  },
  addCommands() {
    const commands = this.parent();
    return { ...commands, setLink: attrs => props => {
      const { tr, state: { schema }, dispatch } = props;
      if (!safeLink(attrs.href)) return false;
      const { $from, $to } = tr.selection;
      // A link label is one destination, including when only its image or a
      // few characters inside it are selected.
      const from = imageLinkAt($from)?.from ?? $from.pos;
      const to = imageLinkAt($to)?.to ?? $to.pos;
      const replacements = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === schema.nodes.image) {
          const image = schema.nodes.inlineImage.create(node.attrs);
          const linked = schema.nodes.imageLink.create(attrs, image);
          replacements.push({ from: pos, to: pos + node.nodeSize, node: schema.nodes.paragraph.create(null, linked) });
          return false;
        }
        if (!node.isTextblock) return;
        const start = Math.max(from, pos + 1), end = Math.min(to, pos + node.nodeSize - 1);
        if (start >= end) return false;
        const content = node.content.cut(start - pos - 1, end - pos - 1);
        const children = [];
        let hasImage = false;
        content.forEach(child => {
          if (child.type === schema.nodes.imageLink) {
            hasImage = true;
            child.content.forEach(part => children.push(part));
          } else {
            hasImage ||= child.type === schema.nodes.inlineImage;
            children.push(child.mark(schema.marks.link.removeFromSet(child.marks)));
          }
        });
        if (hasImage) {
          const original = content.childCount === 1 && content.firstChild.type === schema.nodes.imageLink ? content.firstChild.attrs : {};
          replacements.push({ from: start, to: end, node: schema.nodes.imageLink.create({ ...original, ...attrs }, children) });
        }
        return false;
      });
      if (!replacements.length) return commands.setLink(attrs)(props);
      if (dispatch) {
        // Apply text marks first, then replace image-containing ranges in
        // reverse document order so all original offsets remain valid.
        tr.addMark(from, to, schema.marks.link.create(attrs));
        for (const replacement of replacements.reverse()) tr.replaceWith(replacement.from, replacement.to, replacement.node);
        tr.setMeta('preventAutolink', true);
      }
      return true;
    } };
  },
});

function imageLinkAt(position) {
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === 'imageLink') {
      return { from: position.before(depth), to: position.after(depth) };
    }
  }
}

export function editorLinkTarget(editor) {
  const { doc, schema } = editor.state;
  let { selection } = editor.state;
  const imageLink = imageLinkAt(selection.$from);
  if (imageLink && selection.to <= imageLink.to) selection = NodeSelection.create(doc, imageLink.from);
  if (selection.empty) {
    const range = getMarkRange(selection.$from, schema.marks.link);
    if (range) selection = TextSelection.create(doc, range.from, range.to);
  }
  const href = selection.node?.type.name === 'imageLink' ? selection.node.attrs.href : editor.getAttributes('link').href;
  return { selection, href: href || '', text: doc.textBetween(selection.from, selection.to, ' ') };
}

export function applyEditorLink(editor, target, href, label) {
  if (!safeLink(href) || target.selection.$from.doc !== editor.state.doc) return false;
  const chain = editor.chain().command(({ tr }) => { tr.setSelection(target.selection); return true; });
  if (target.selection.empty) {
    return chain.insertContent({ type: 'text', text: label.trim() || href, marks: [{ type: 'link', attrs: { href } }] }).run();
  }
  return chain.setLink({ href }).run();
}

function markdownTitle(title) {
  return title ? ' "' + title.replace(/[\\"]/g, '\\$&') + '"' : '';
}

export function imageRangeInCode(editor, range) {
  return [range.from, range.to].some(position => editor.state.doc.resolve(position).parent.type.spec.code);
}

export function insertEditorImages(editor, range, images) {
  if (imageRangeInCode(editor, range)) throw new Error(t('请将光标移出代码块后再插入图片。'));
  const inserted = editor.chain().command(({ tr }) => { closeHistory(tr); return true; })
    .insertContentAt(range, images.map(image => ({ type: 'image', attrs: image }))).run();
  if (!inserted) throw new Error(t('无法在此位置插入图片。'));
  // Keep the next keystroke out of this batch's history event as well.
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function createEditor(element, markdown = '', options = {}) {
  const MarkdownImage = Image.extend({
    markdownTokenName: 'blockImage',
    renderMarkdown(node) {
      const alt = (node.attrs.alt || '').replace(/[\\\[\]]/g, '\\$&');
      const src = (node.attrs.src || '').replace(/[\s()<>"\\]/g, character =>
        /[()]/.test(character) ? '\\' + character : encodeURIComponent(character));
      return `![${alt}](${src}${markdownTitle(node.attrs.title)})`;
    }
  });
  const ImageExtension = options.imageURL ? MarkdownImage.extend({
    addNodeView() {
      return ({ node }) => {
        const figure = document.createElement(node.isInline ? 'span' : 'figure'); figure.contentEditable = 'false';
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
        return { dom: figure, update(next) { if (next.type !== node.type) return false; render(next); return true; } };
      };
    }
  }) : MarkdownImage;
  const InlineImage = ImageExtension.extend({
    name: 'inlineImage', markdownTokenName: 'image',
    parseMarkdown(token, helpers) {
      return helpers.createNode('inlineImage', this.parent(token, helpers).attrs);
    },
    // Native HTML paste can contain images inside paragraphs and links.
    parseHTML() { return this.parent().map(rule => ({ ...rule, priority: 55 })); },
    addCommands() { return {}; },
    addInputRules() { return []; },
  });
  const editor = new Editor({
    element,
    editable: options.editable ?? true,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false, paragraph: false }),
      MarkdownParagraph, MarkdownLink.configure({ openOnClick: false, autolink: false, isAllowedUri: url => safeLink(url) }),
      MarkdownCodeBlock.configure({ lowlight }),
      TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }),
      ImageExtension.configure({ inline: false, allowBase64: false }),
      InlineImage.configure({ inline: true, allowBase64: false }), ImageLink,
      Placeholder.configure({ placeholder: () => t('写下你的第一句话…') }),
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: markdown.replace(/^\ufeff/, ''), contentType: 'markdown',
    editorProps: { attributes: () => ({ 'aria-label': t('文档正文'), spellcheck: 'false' }),
      ...(options.handlePaste ? { handlePaste: options.handlePaste } : {}),
      ...(options.handleDrop ? { handleDrop: options.handleDrop } : {}),
    },
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
