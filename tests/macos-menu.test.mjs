import test from 'node:test';
import assert from 'node:assert/strict';
import { createMacMenuTemplate } from '../src/macos-menu.mjs';

function menu(t = value => value) {
  const commands = [], template = createMacMenuTemplate({ t, dispatch: command => commands.push(command) });
  const items = template.flatMap(item => item.submenu || []);
  return { template, items, commands, item: command => items.find(item => item.id === 'md-' + command) };
}

test('native actions dispatch one fixed renderer command including save-as and close-tab', () => {
  const f = menu();
  for (const command of ['new', 'new-mindmap', 'open', 'save', 'save-as', 'close-tab', 'undo', 'redo', 'settings', 'check-updates', 'help']) {
    assert.ok(f.item(command), command); f.item(command).click();
  }
  assert.deepEqual(f.commands, ['new', 'new-mindmap', 'open', 'save', 'save-as', 'close-tab', 'undo', 'redo', 'settings', 'check-updates', 'help']);
  assert.equal(f.item('close-tab').role, undefined, 'Cmd+W closes a document tab rather than the native window');
  assert.equal(f.item('close-tab').accelerator, 'Command+W');
  assert.equal(f.item('save-as').accelerator, 'Command+Shift+S');
  assert.equal(f.item('undo').role, undefined, 'shared editor history stays renderer-owned');
});

test('localized menu preserves standard native editing and app lifecycle roles', () => {
  const f = menu(value => 'translated:' + value);
  assert.equal(f.template[0].label, 'MD');
  assert.equal(f.item('settings').label, 'translated:设置');
  assert.equal(f.item('open').label, 'translated:打开');
  for (const role of ['about', 'hide', 'hideOthers', 'unhide', 'quit', 'cut', 'copy', 'paste', 'selectAll', 'minimize', 'zoom']) {
    assert.ok(f.items.some(item => item.role === role), role);
  }
});
