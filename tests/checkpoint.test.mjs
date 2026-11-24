import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointController, checkpointDraft } from '../src/checkpoint.mjs';

test('checkpoint payloads keep the exact UTF-8 limit and omit the oversized text', () => {
  const limit = 8 * 1024 * 1024;
  const text = '𠮷'.repeat(limit / 4);
  assert.equal(checkpointDraft(text).draft, text);
  assert.deepEqual(checkpointDraft(text + 'a'), { draftTooLarge: true });
  assert.deepEqual(checkpointDraft('a'.repeat(limit + 1)), { draftTooLarge: true });
});

test('a flush arriving while an unchanged drain is completing still persists its latest snapshot', async () => {
  let value = 0; const written = [];
  const controller = createCheckpointController({ collect: () => ({ value }), write: async snapshot => { written.push(snapshot.value); }, interval: 0 });
  await controller.flush();
  const first = controller.flush(); value = 1; const second = controller.flush();
  await Promise.all([first, second]); assert.deepEqual(written, [0, 1]); controller.stop();
});

test('recovery checkpoints serialize writes and capture the newest draft while a write is pending', async () => {
  let value = 'first', release;
  const written = [], states = [];
  const controller = createCheckpointController({ collect: () => ({ value }), write: async snapshot => { written.push(snapshot.value); if (written.length === 1) await new Promise(resolve => { release = resolve; }); }, onState: status => states.push(status), interval: 0 });
  const first = controller.flush(); await Promise.resolve();
  value = 'latest'; const second = controller.flush(); release();
  await Promise.all([first, second]); assert.deepEqual(written, ['first', 'latest']);
  await controller.flush(); assert.deepEqual(written, ['first', 'latest'], 'unchanged snapshots are not written repeatedly');
  assert.equal(states.at(-1), 'saved'); controller.stop();
});

test('failed backup retries without losing the draft and composing snapshots are skipped', async () => {
  let attempts = 0, composing = true; const errors = [];
  const controller = createCheckpointController({ collect: () => composing ? null : { content: '中文草稿' }, write: async () => { if (++attempts === 1) throw new Error('disk full'); }, onState: (state, error) => { if (error) errors.push(error.message); }, interval: 0 });
  await controller.flush(); assert.equal(attempts, 0);
  composing = false; await controller.flush(); assert.equal(attempts, 1); assert.deepEqual(errors, ['disk full']);
  await controller.flush(); assert.equal(attempts, 2);
  controller.stop(); await controller.flush(); assert.equal(attempts, 2);
});

test('returning to the last saved draft after an intervening failure clears the error', async () => {
  let value = 'A'; const written = [], states = [];
  const controller = createCheckpointController({
    collect: () => ({ value }), interval: 0,
    write: async ({ value }) => { written.push(value); if (value === 'B') throw new Error('disk full'); },
    onState: status => states.push(status),
  });
  try {
    await controller.flush(); value = 'B'; await controller.flush();
    assert.equal(states.at(-1), 'error');
    value = 'A'; await controller.flush();
    assert.equal(states.at(-1), 'saved');
    assert.deepEqual(written, ['A', 'B', 'A']);
  } finally { controller.stop(); }
});
