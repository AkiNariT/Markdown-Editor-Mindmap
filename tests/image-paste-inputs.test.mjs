import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as transfer from '../src/image-transfer.mjs';

function fixture() {
  const dom = new JSDOM('<input id="filename"><input id="skill-name"><textarea id="skill-description"></textarea><textarea class="source-input"></textarea><div contenteditable="true"></div>');
  dom.window.document.addEventListener('paste', transfer.protectTextInputImagePaste);
  return dom;
}
function paste(dom, target, text = '', withImage = true) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    files: withImage ? [new File(['png'], 'shot.png', { type: 'image/png' })] : [],
    getData: type => type === 'text/plain' ? text : '',
  } });
  target.dispatchEvent(event);
  return event;
}

test('image-only paste cannot delete the selected text in naming and metadata fields', () => {
  const dom = fixture();
  try {
    for (const field of dom.window.document.querySelectorAll('#filename, #skill-name, #skill-description')) {
      field.value = 'Untitled.md'; field.setSelectionRange(0, 8);
      const event = paste(dom, field);
      // Text controls normally replace the selection with the clipboard text,
      // which is empty for an image-only Windows clipboard.
      if (!event.defaultPrevented) field.setRangeText('', field.selectionStart, field.selectionEnd);
      assert.equal(field.value, 'Untitled.md', field.id);
      assert.equal(event.defaultPrevented, true);
    }
  } finally { dom.window.close(); }
});

test('text and mixed clipboard pastes remain native while document editors keep their own image handlers', () => {
  const dom = fixture();
  try {
    const field = dom.window.document.querySelector('#filename');
    for (const withImage of [false, true]) {
      field.value = 'Untitled.md'; field.setSelectionRange(0, 8);
      const event = paste(dom, field, 'Renamed', withImage);
      assert.equal(event.defaultPrevented, false);
      field.setRangeText('Renamed', field.selectionStart, field.selectionEnd);
      assert.equal(field.value, 'Renamed.md');
    }
    for (const editor of dom.window.document.querySelectorAll('.source-input, [contenteditable]')) {
      assert.equal(paste(dom, editor).defaultPrevented, false);
    }
  } finally { dom.window.close(); }
});
