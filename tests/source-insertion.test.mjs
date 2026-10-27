import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSourceEditor, fromSourceText, toSourceText } from '../src/source.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const name of ['document', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, {
    value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name],
    configurable: true,
  });
}

function setup(t, text, onInput = () => {}) {
  const source = createSourceEditor(onInput);
  document.body.append(source.host);
  source.input.style.lineHeight = '24px';
  source.input.readOnly = false;
  source.setText(text);
  t.after(() => { source.destroy(); source.host.remove(); });
  return source;
}

function type(source, text) {
  source.input.dispatchEvent(new dom.window.InputEvent('beforeinput', { inputType: 'insertText', data: text }));
  source.input.setRangeText(text, source.input.selectionStart, source.input.selectionEnd, 'end');
  source.input.dispatchEvent(new dom.window.InputEvent('input', { inputType: 'insertText', data: text }));
}

test('source replacement keeps context and scroll while refreshing once before notifying the document', t => {
  const changes = [];
  const source = setup(t, 'one SELECT tail', context => changes.push({
    context, text: source.getText(), position: source.host.querySelector('.source-position').textContent,
    gutter: source.host.querySelector('.source-gutter').textContent,
  }));
  const context = { lossy: true };
  source.setText('one SELECT tail', { context });
  source.input.setSelectionRange(4, 10);
  source.input.scrollTop = 96;
  source.input.scrollLeft = 37;

  source.replaceSelection('![x](a.png)\nline');

  assert.equal(source.getText(), 'one ![x](a.png)\nline tail');
  assert.equal(source.input.selectionStart, 20);
  assert.equal(source.input.selectionEnd, 20);
  assert.equal(source.input.scrollTop, 96);
  assert.equal(source.input.scrollLeft, 37);
  assert.deepEqual(changes, [{ context, text: 'one ![x](a.png)\nline tail', position: '2 行 · 5 列', gutter: '1\n2' }]);
  assert.equal(source.undo(), true);
  assert.equal(source.getText(), 'one SELECT tail');
  assert.equal(source.input.selectionStart, 4);
  assert.equal(source.input.selectionEnd, 10);
  assert.equal(source.input.scrollTop, 96);
  assert.equal(source.input.scrollLeft, 37);
  assert.equal(changes[1].context, context);
  assert.equal(source.redo(), true);
  assert.equal(source.getText(), 'one ![x](a.png)\nline tail');
  assert.equal(source.input.selectionStart, 20);
  assert.equal(source.input.selectionEnd, 20);
});

test('captured ranges replace their original selection even while the source is temporarily read-only', t => {
  const source = setup(t, 'before target after');
  source.input.setSelectionRange(7, 13);
  const captured = { start: source.input.selectionStart, end: source.input.selectionEnd };
  source.input.setSelectionRange(0, 0);
  source.input.readOnly = true;

  source.replaceSelection('![photo](assets/photo.png)', captured);

  assert.equal(source.getText(), 'before ![photo](assets/photo.png) after');
  assert.equal(source.input.selectionStart, 33);
  assert.equal(source.input.selectionEnd, 33);
  assert.equal(source.input.readOnly, true);
});

test('source image insertion is a single undo step separate from typing on both sides', t => {
  const source = setup(t, 'base');
  source.input.setSelectionRange(4, 4);
  type(source, 'A');
  type(source, 'B');
  source.replaceSelection('![x](a.png)');
  type(source, 'C');
  type(source, 'D');
  assert.equal(source.getText(), 'baseAB![x](a.png)CD');

  for (const expected of ['baseAB![x](a.png)', 'baseAB', 'base']) {
    assert.equal(source.undo(), true);
    assert.equal(source.getText(), expected);
  }
  assert.equal(source.undo(), false);
  for (const expected of ['baseAB', 'baseAB![x](a.png)', 'baseAB![x](a.png)CD']) {
    assert.equal(source.redo(), true);
    assert.equal(source.getText(), expected);
  }
  assert.equal(source.redo(), false);
});

test('source insertion separates adjacent visual history and clears the abandoned redo branch', t => {
  const source = setup(t, 'base');
  source.setText('base visual', { record: true });
  source.input.setSelectionRange(11, 11);
  source.replaceSelection('![x](a.png)');
  source.setText('base visual![x](a.png) next', { record: true });

  for (const expected of ['base visual![x](a.png)', 'base visual', 'base']) {
    assert.equal(source.undo(), true);
    assert.equal(source.getText(), expected);
  }
  assert.equal(source.redo(), true);
  assert.equal(source.getText(), 'base visual');
  source.replaceSelection(' replacement', { start: 4, end: 11 });
  assert.equal(source.getText(), 'base replacement');
  assert.equal(source.redo(), false);
});

test('source insertion retains the document BOM and CRLF convention when the edited text is serialized', t => {
  const original = '\ufeffbefore\r\nafter\r\n';
  const source = setup(t, toSourceText(original));

  source.replaceSelection('![x](a.png)\n', { start: 7, end: 7 });

  assert.equal(fromSourceText(source.getText(), original), '\ufeffbefore\r\n![x](a.png)\r\nafter\r\n');
  assert.equal(source.undo(), true);
  assert.equal(fromSourceText(source.getText(), original), original);
});
