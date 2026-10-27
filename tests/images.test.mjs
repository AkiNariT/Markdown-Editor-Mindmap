import test from 'node:test';
import assert from 'node:assert/strict';
import * as imageHelpers from '../src/images.mjs';
const { rebaseImages } = imageHelpers;
test('Save As rebases inline destination without replacing matching alt text', () => {
  assert.equal(rebaseImages('![pic.png](pic.png)\n', 'C:/notes', 'C:/notes/copy'), '![pic.png](../pic.png)\n');
});
test('Save As rebases reference-style image definitions while preserving markup', () => {
  assert.equal(rebaseImages('![示例][img]\n\n[img]: assets/pic.png "标题"\n', 'C:/notes', 'C:/notes/copy'), '![示例][img]\n\n[img]: ../assets/pic.png "标题"\n');
});
test('Save As does not modify image examples in fenced code or remote images', () => {
  assert.equal(rebaseImages('```md\n![示例](a.png)\n```\n\n![图片](https://example.com/a.png)\n', 'C:/notes', 'C:/notes/copy'), '```md\n![示例](a.png)\n```\n\n![图片](https://example.com/a.png)\n');
});
test('Save As leaves a code example intact when the same image markup occurs outside code', () => {
  assert.equal(rebaseImages('```md\n![示例](a.png)\n```\n\n![示例](a.png)\n', 'C:/notes', 'C:/notes/copy'), '```md\n![示例](a.png)\n```\n\n![示例](../a.png)\n');
});

test('draft image rewriting changes destinations only, preserving examples, titles, alt text and unrelated links', () => {
  assert.equal(typeof imageHelpers.rewriteImageDestinations, 'function');
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const input = `\`![x](${from})\`\n\n![${from}](${from} "${from}")\n\n[ordinary](${from})\n`;
  const expected = `\`![x](${from})\`\n\n![${from}](${to} "${from}")\n\n[ordinary](${from})\n`;
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), expected);
});

test('draft image rewriting preserves escaped image text and HTML comments identical to an actual image', () => {
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const input = `\\![x](${from})\n\n<!-- ![x](${from}) -->\n\n![x](${from})\n`;
  const expected = `\\![x](${from})\n\n<!-- ![x](${from}) -->\n\n![x](${to})\n`;
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), expected);
});

test('draft image rewriting finds the destination before delimiter-like text in the title', () => {
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const input = `![a [nested] label](${from} "title ]( sample")\n`;
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), `![a [nested] label](${to} "title ]( sample")\n`);
});

test('draft image rewriting handles escaped destinations and reference definitions inside block quotes', () => {
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const escaped = from.replace(':', '\\:');
  const input = `![x](${escaped})\n\n> ![reference][image]\n>\n> [image]: <${from}> "reference title"\n`;
  const expected = `![x](${to})\n\n> ![reference][image]\n>\n> [image]: <${to}> "reference title"\n`;
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), expected);
});

test('draft image rewriting handles multiline block quote images without changing quoted code examples', () => {
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const input = `> \`\`\`md\n> ![x](${from})\n> \`\`\`\n\n> ![a\n> multiline label](<${from}>)\n`;
  const expected = `> \`\`\`md\n> ![x](${from})\n> \`\`\`\n\n> ![a\n> multiline label](<${to}>)\n`;
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), expected);
});

test('draft reference image rewriting accepts multiline labels without rewriting a matching code example', () => {
  const from = 'md-draft-image:11111111-1111-4111-8111-111111111111.png', to = 'note.assets/image.png';
  const input = `![x][a\n b]\n\n[a\n b]: ${from}\n\n\`\`\`md\n[a\n b]: ${from}\n\`\`\`\n`;
  const expected = `![x][a\n b]\n\n[a\n b]: ${to}\n\n\`\`\`md\n[a\n b]: ${from}\n\`\`\`\n`;
  assert.deepEqual(imageHelpers.imageDestinations(input), [from]);
  assert.equal(imageHelpers.rewriteImageDestinations(input, new Map([[from, to]])), expected);
});
