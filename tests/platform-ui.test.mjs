import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createPlatformUI, createNativeCommandHandler } from '../src/platform-ui.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
test('Mac settings explain Finder defaults and shortcuts without changing document text', () => {
  const dom = new JSDOM(html), document = dom.window.document;
  const ui = createPlatformUI({ document, platform: 'darwin' });
  const content = document.createElement('p');
  content.title = 'Ctrl+S'; content.textContent = 'Document says Ctrl+S';
  document.querySelector('#editor').append(content);
  ui.refresh();
  assert.equal(document.querySelector('.settings-default-app').hidden, true);
  assert.equal(document.querySelector('#mac-default-app').hidden, false);
  assert.match(document.querySelector('#open').title, /⌘\+O/);
  assert.equal(document.querySelector('#redo .shortcut').textContent, '⌘+Shift+Z');
  assert.match(document.querySelector('#zoom-reset').title, /Ctrl＋滚轮/);
  assert.match(document.querySelector('#zoom-reset').title, /⌘\+0/);
  assert.match(document.body.textContent, /Ctrl\+Tab \/ Ctrl\+Shift\+Tab/);
  assert.equal(content.title, 'Ctrl+S');
  assert.equal(content.textContent, 'Document says Ctrl+S');
  document.querySelector('#open').title = 'Open Ctrl+O';
  ui.refresh();
  assert.equal(document.querySelector('#open').title, 'Open ⌘+O');
});

test('Windows keeps registration controls and Control hints', () => {
  const dom = new JSDOM(html), document = dom.window.document;
  createPlatformUI({ document, platform: 'win32' }).refresh();
  assert.equal(document.querySelector('.settings-default-app').hidden, false);
  assert.equal(document.querySelector('#mac-default-app').hidden, true);
  assert.match(document.querySelector('#open').title, /Ctrl\+O/);
  assert.equal(document.querySelector('#redo .shortcut').textContent, 'Ctrl+Y');
});

test('native commands respect locks, dialogs and the fixed action set', () => {
  const dom = new JSDOM('<button id="save">save</button><dialog></dialog>');
  const document = dom.window.document; let saved = 0, locked = false;
  const dispatch = createNativeCommandHandler({ document, canAct: () => !locked, actions: { save: () => { saved++; } }, history: () => {}, nativeHistory: () => {} });
  assert.equal(dispatch('save'), true); assert.equal(saved, 1);
  locked = true; assert.equal(dispatch('save'), false); assert.equal(saved, 1);
  locked = false; document.querySelector('dialog').setAttribute('open', '');
  assert.equal(dispatch('save'), false); assert.equal(saved, 1);
  document.querySelector('dialog').removeAttribute('open');
  for (const value of ['toString', '__proto__', 'not-a-command', null, { command: 'save' }]) assert.equal(dispatch(value), false);
});

test('native undo uses document history for editors and native history for dialog text', () => {
  const dom = new JSDOM('<div id="editor" contenteditable="true" tabindex="0"></div><textarea class="source-input"></textarea><section class="mindmap-view"><input></section><dialog open><input id="name"></dialog>');
  const document = dom.window.document, documentEdits = [], textEdits = [];
  const dispatch = createNativeCommandHandler({ document, canAct: () => true, actions: {}, history: value => documentEdits.push(value), nativeHistory: value => textEdits.push(value) });
  document.querySelector('#name').focus();
  assert.equal(dispatch('undo'), true); assert.deepEqual(textEdits, ['undo']);
  document.querySelector('dialog').removeAttribute('open');
  for (const selector of ['#editor', '.source-input', '.mindmap-view input']) {
    document.querySelector(selector).focus(); assert.equal(dispatch('redo'), true);
  }
  assert.deepEqual(documentEdits, ['redo', 'redo', 'redo']);
  assert.deepEqual(textEdits, ['undo']);
});
