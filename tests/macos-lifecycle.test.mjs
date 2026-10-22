import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOpenQueue } from '../src/open-queue.mjs';
import { createMacLifecycle } from '../src/macos-lifecycle.mjs';

function fixture() {
  const app = new EventEmitter(), window = new EventEmitter(), opened = [];
  let available = false, ready = false, guards = 0, approved = false, quits = 0, minimized = false, visible = true;
  const event = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  Object.assign(window, {
    isDestroyed: () => false, isMinimized: () => minimized,
    restore() { minimized = false; }, show() { visible = true; }, focus() {}, hide() { visible = false; },
    close() { const value = event(); window.emit('close', value); return value.defaultPrevented; },
  });
  const queue = createOpenQueue({ canRun: () => ready, open: async file => opened.push(file) });
  app.quit = () => { const value = event(); app.emit('before-quit', value); if (!value.defaultPrevented) { quits++; window.close(); } };
  const lifecycle = createMacLifecycle({ app, getWindow: () => available ? window : null, enqueueOpen: file => queue.enqueue([file]) });
  window.on('close', value => {
    if (approved || lifecycle.hideOnClose(value)) return;
    value.preventDefault(); guards++;
  });
  return { app, window, lifecycle, opened, queue, event,
    expose() { available = true; }, async ready() { ready = true; await queue.drain(); },
    minimize() { minimized = true; visible = false; },
    approve() { approved = true; lifecycle.confirmQuit(); },
    state: () => ({ guards, quits, visible, minimized }),
  };
}

test('Finder events before readiness wait in order and reject unsupported paths', async () => {
  const f = fixture();
  for (const file of ['/tmp/中文 A.md', '/tmp/Plan.MDMAP', '/tmp/notes.markdown']) {
    const event = f.event(); f.app.emit('open-file', event, file); assert.equal(event.defaultPrevented, true);
  }
  for (const file of ['/tmp/photo.png', '/tmp/name.md\0', null, '']) {
    const event = f.event(); f.app.emit('open-file', event, file); assert.equal(event.defaultPrevented, false);
  }
  await f.queue.drain(); assert.deepEqual(f.opened, []);
  f.expose(); await f.ready();
  assert.deepEqual(f.opened, ['/tmp/中文 A.md', '/tmp/Plan.MDMAP', '/tmp/notes.markdown']);
});

test('red close hides retained workspace without running document close guards', () => {
  const f = fixture(); f.expose();
  assert.equal(f.window.close(), true);
  assert.deepEqual(f.state(), { guards: 0, quits: 0, visible: false, minimized: false });
  f.app.emit('activate'); assert.equal(f.state().visible, true);
});

test('Finder activation restores a minimized retained window', async () => {
  const f = fixture(); f.expose(); await f.ready(); f.minimize();
  f.app.emit('open-file', f.event(), '/tmp/again.md'); await f.queue.drain();
  assert.deepEqual(f.opened, ['/tmp/again.md']);
  assert.equal(f.state().minimized, false); assert.equal(f.state().visible, true);
});

test('explicit Quit runs one close guard and cancel returns to ordinary hide behavior', () => {
  const f = fixture(); f.expose(); f.window.close();
  f.app.quit(); f.app.quit();
  assert.deepEqual(f.state(), { guards: 1, quits: 0, visible: true, minimized: false });
  f.lifecycle.cancelQuit(); f.window.close();
  assert.deepEqual(f.state(), { guards: 1, quits: 0, visible: false, minimized: false });
});

test('confirmed Quit re-enters application quit once without hiding the window', () => {
  const f = fixture(); f.expose(); f.app.quit(); f.approve();
  assert.deepEqual(f.state(), { guards: 1, quits: 1, visible: true, minimized: false });
});

test('startup failure or no remaining window does not trap the application', () => {
  const f = fixture(); f.app.quit(); assert.equal(f.state().quits, 1);
  const running = fixture(); running.expose(); running.lifecycle.allowQuit(); running.app.quit();
  assert.equal(running.state().quits, 1);
});
