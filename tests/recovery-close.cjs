const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, unlink, access } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const running = new Set();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout; let latest;
  while (Date.now() < deadline) {
    try { latest = await read(); if (predicate(latest)) return latest; } catch (error) { latest = error.message; }
    await sleep(40);
  }
  throw new Error(label + ': ' + JSON.stringify(latest));
}
async function stored(profile, predicate = () => true) {
  return until(async () => JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8')), predicate, 'durable recovery snapshot');
}
async function api(page, name, ...args) {
  return until(() => page.evaluate(({ name, args }) => window.moye[name](...args), { name, args }), result => !result?.error?.includes('正在处理文档'), name);
}
async function launch(profile, documents = []) {
  const executablePath = process.env.MOYE_EXE || require('electron');
  const app = await electron.launch({ executablePath, args: [...(process.env.MOYE_EXE ? [] : [path.resolve(__dirname, '..')]), ...documents, '--user-data-dir=' + profile], timeout: 30000 });
  const handle = { app, profile, page: await app.firstWindow(), errors: [] }; running.add(handle);
  handle.page.setDefaultTimeout(12000); handle.page.on('pageerror', error => handle.errors.push(error.message));
  await handle.page.waitForSelector('.tiptap', { state: 'attached' });
  await handle.page.waitForFunction(() => document.querySelectorAll('[role=tab]').length > 0 && !document.querySelector('#mode').disabled);
  await app.evaluate(({ dialog }) => { dialog.showErrorBox = (_title, message) => { globalThis.recoveryErrors ??= []; globalThis.recoveryErrors.push(message); }; });
  return handle;
}
async function abrupt(handle) {
  if (!running.has(handle)) return;
  await handle.app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await handle.app.close().catch(() => {}); running.delete(handle);
}
async function closeWindow(handle) {
  const closed = handle.page.waitForEvent('close');
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed; await handle.app.close().catch(() => {}); running.delete(handle);
  assert.deepEqual(handle.errors, []);
}
async function replies(handle, values) {
  await handle.app.evaluate(({ dialog }, values) => {
    globalThis.recoveryPrompts = []; globalThis.recoveryReplies = values;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.recoveryPrompts.push(options.message);
      return { response: globalThis.recoveryReplies.length > 1 ? globalThis.recoveryReplies.shift() : globalThis.recoveryReplies[0] ?? 2 };
    };
    dialog.showSaveDialog = async () => ({ canceled: true });
  }, values);
}
async function select(handle, file) {
  const current = await api(handle.page, 'ready'), document = current.documents.find(item => item.path === file);
  assert.ok(document, 'expected an open tab for ' + file);
  const result = await api(handle.page, 'activateTab', document.id); assert.equal(result.ok, true, JSON.stringify(result));
  await handle.page.waitForFunction(file => document.querySelector('#file-path').textContent === file, file);
  return document.id;
}
async function edit(handle, content) {
  const page = handle.page;
  await page.getByRole('button', { name: '源码', exact: true }).click();
  if (await page.getByRole('button', { name: '编辑', exact: true }).count()) await page.getByRole('button', { name: '编辑', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Markdown 源码', exact: true });
  await page.waitForFunction(() => !document.querySelector('.source-input').readOnly);
  await input.fill(content);
  await page.waitForFunction(() => !document.querySelector('#dirty-dot').hidden);
  return (await api(page, 'ready')).id;
}
async function assertRecovered(handle, file, original, draft) {
  const current = await api(handle.page, 'ready'), document = current.documents.find(item => item.path === file);
  assert.ok(document, 'recovered document should exist');
  assert.equal(document.content, original, 'saved baseline remains separate from the recovered draft');
  assert.equal(document.recovery?.draft, draft);
  await select(handle, file);
  await handle.page.getByRole('button', { name: '源码', exact: true }).click();
  assert.equal(await handle.page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).inputValue(), draft ?? original);
}
async function beginCheckpoint(page) {
  await page.evaluate(async () => {
    const value = await window.moye.ready();
    window.recoveryPendingCheckpoint = window.moye.checkpoint({ activeId: value.id, documents: value.documents.map(item => ({ id: item.id, draft: item.recovery?.draft ?? item.content, dirty: item.dirty, visualLossy: item.recovery?.visualLossy, viewState: item.recovery?.viewState })) });
  });
}

(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'recovery-close-'));

  // An explicit discard keeps a file tab at its baseline and removes a scratch
  // tab from both primary and fallback snapshots.
  {
    const profile = path.join(directory, 'discard-profile'), file = path.join(directory, 'discard.md'), original = '# discard original\n';
    await writeFile(file, original); let handle = await launch(profile, [file]);
    await edit(handle, '# discard original\n\nDISCARDED_FILE_DRAFT');
    await handle.page.getByRole('button', { name: '新建', exact: true }).click();
    const scratchId = await edit(handle, 'DISCARDED_SCRATCH_DRAFT');
    await stored(profile, value => value.documents.some(item => item.id === scratchId && item.draft === 'DISCARDED_SCRATCH_DRAFT'));
    await replies(handle, [1]); await closeWindow(handle);
    for (const name of ['session.json', 'session.backup.json']) {
      const value = JSON.parse(await readFile(path.join(profile, name), 'utf8'));
      assert.equal(value.documents.length, 1); assert.equal(value.documents[0].dirty, false); assert.equal(value.documents[0].draft, undefined);
      assert.equal(value.documents.some(item => item.id === scratchId), false);
    }
    assert.equal(await readFile(file, 'utf8'), original);
    handle = await launch(profile); await assertRecovered(handle, file, original, undefined);
    assert.equal((await api(handle.page, 'ready')).documents.length, 1); await abrupt(handle);
    console.log('PASS explicit discard stays discarded after restart, including fallback and scratch tabs');
  }

  // Cancel on a later tab must not commit an earlier discard choice.
  {
    const profile = path.join(directory, 'cancel-profile'), a = path.join(directory, 'cancel-a.md'), b = path.join(directory, 'cancel-b.md');
    const originalA = '# A original\n', originalB = '# B original\n', draftA = '# A original\n\nKEEP_A_AFTER_CANCEL', draftB = '# B original\n\nKEEP_B_AFTER_CANCEL';
    await writeFile(a, originalA); await writeFile(b, originalB); let handle = await launch(profile, [a, b]);
    const initial = await api(handle.page, 'ready');
    const staleActive = await api(handle.page, 'checkpoint', { activeId: initial.documents.find(item => item.path === a).id, documents: [] });
    assert.equal(staleActive.ok, true); assert.equal((await api(handle.page, 'ready')).id, initial.id, 'an old renderer activeId must not undo main-process activation');
    await edit(handle, draftB); await select(handle, a); await edit(handle, draftA);
    await stored(profile, value => value.documents.some(item => item.path === a && item.draft === draftA) && value.documents.some(item => item.path === b && item.draft === draftB));
    await replies(handle, [1, 2]);
    await handle.page.evaluate(() => { window.recoveryCanceled = 0; window.moye.onClosingCanceled(() => window.recoveryCanceled++); });
    await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await handle.page.waitForFunction(() => window.recoveryCanceled === 1);
    assert.equal((await handle.app.evaluate(() => globalThis.recoveryPrompts)).length, 2);
    assert.equal(handle.page.isClosed(), false);
    assert.equal(await handle.page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).inputValue(), draftA);
    await abrupt(handle); handle = await launch(profile);
    await assertRecovered(handle, a, originalA, draftA); await assertRecovered(handle, b, originalB, draftB);
    const bId = (await api(handle.page, 'ready')).id;
    await replies(handle, [1]);
    const closedTab = await api(handle.page, 'closeTab', bId); assert.equal(closedTab.ok, true, JSON.stringify(closedTab));
    await stored(profile, value => !value.documents.some(item => item.id === bId));
    const backup = JSON.parse(await readFile(path.join(profile, 'session.backup.json'), 'utf8'));
    assert.equal(backup.documents.some(item => item.id === bId), false);
    await abrupt(handle); handle = await launch(profile);
    assert.equal((await api(handle.page, 'ready')).documents.some(item => item.path === b), false);
    await assertRecovered(handle, a, originalA, draftA);
    assert.equal(await readFile(a, 'utf8'), originalA); assert.equal(await readFile(b, 'utf8'), originalB);
    await abrupt(handle); console.log('PASS late cancel restores every draft; explicitly closed tab stays closed');
  }

  // Restoring cached originals must retain their saved hashes, including when
  // a file is now missing, so Save cannot overwrite newly changed disk state.
  {
    const profile = path.join(directory, 'conflict-profile'), missing = path.join(directory, 'missing.md'), changed = path.join(directory, 'changed.md');
    const oldMissing = '# missing original\n', oldChanged = '# changed original\n', missingDraft = '# missing draft\n', changedDraft = '# changed draft\n', external = '# external replacement\n';
    await writeFile(missing, oldMissing); await writeFile(changed, oldChanged); let handle = await launch(profile, [missing, changed]);
    const fingerprints = new Map((await api(handle.page, 'ready')).documents.map(item => [item.path, item.fingerprint]));
    await edit(handle, changedDraft); await select(handle, missing); await edit(handle, missingDraft);
    await stored(profile, value => value.documents.some(item => item.path === missing && item.draft === missingDraft) && value.documents.some(item => item.path === changed && item.draft === changedDraft));
    await abrupt(handle); await unlink(missing); await writeFile(changed, external);
    handle = await launch(profile); const recovered = await api(handle.page, 'ready');
    assert.match(recovered.recoveryNotice, /外部变化/); assert.match(recovered.recoveryNotice, /无法从原位置读取/);
    for (const item of recovered.documents) assert.equal(item.fingerprint, fingerprints.get(item.path));
    await assertRecovered(handle, missing, oldMissing, missingDraft);
    const missingSave = await api(handle.page, 'save', missingDraft, false, true); assert.match(missingSave.error, /外部修改或删除/);
    await assert.rejects(access(missing), { code: 'ENOENT' });
    await assertRecovered(handle, changed, oldChanged, changedDraft);
    const changedSave = await api(handle.page, 'save', changedDraft, false, true); assert.match(changedSave.error, /外部修改或删除/);
    assert.equal(await readFile(changed, 'utf8'), external);
    await abrupt(handle); console.log('PASS missing and externally changed originals keep overwrite protection after recovery');
  }

  // Hold a real FileHandle.sync at the storage boundary to deterministically
  // request Close while checkpoint owns main's busy flag. This hook exists only
  // inside this test process; no user process or production file is modified.
  {
    const profile = path.join(directory, 'queued-profile'), file = path.join(directory, 'queued.md'), original = '# queued original\n', draft = '# queued original\n\nQUEUED_DISCARD';
    await writeFile(file, original); let handle = await launch(profile, [file]);
    await edit(handle, draft); await stored(profile, value => value.documents[0]?.draft === draft);
    await replies(handle, [1]);
    await handle.app.evaluate(async (_electron, profile) => {
      const fs = process.getBuiltinModule('node:fs').promises, path = process.getBuiltinModule('node:path');
      const probe = await fs.open(path.join(profile, 'sync-probe'), 'w');
      const prototype = Object.getPrototypeOf(probe), original = prototype.sync;
      await probe.close(); await fs.unlink(path.join(profile, 'sync-probe'));
      globalThis.recoveryRestoreSync = () => { prototype.sync = original; };
      const gatedSync = async function (...args) {
        if (globalThis.recoveryHoldNextSync) {
          globalThis.recoveryHoldNextSync = false; globalThis.recoverySyncHeld = true;
          await new Promise(resolve => { globalThis.recoveryReleaseSync = resolve; });
        }
        return original.apply(this, args);
      };
      globalThis.recoveryArmSync = () => { globalThis.recoveryHoldNextSync = true; globalThis.recoverySyncHeld = false; prototype.sync = gatedSync; };
      globalThis.recoveryArmSync();
    }, profile);
    await beginCheckpoint(handle.page);
    await until(() => handle.app.evaluate(() => globalThis.recoverySyncHeld), Boolean, 'checkpoint should be inside durable sync');
    await handle.page.evaluate(async () => {
      const value = await window.moye.ready();
      window.recoveryForegroundResult = undefined;
      window.moye.activateTab(value.id).then(result => { window.recoveryForegroundResult = result; });
    });
    const snapshot = await api(handle.page, 'ready');
    assert.ok(snapshot.documents.some(item => item.recovery?.draft?.includes('QUEUED_DISCARD')), 'read-only state remains available while a checkpoint is writing');
    await sleep(80);
    assert.equal(await handle.page.evaluate(() => window.recoveryForegroundResult), undefined, 'foreground activation waits for checkpoint instead of returning a busy error');
    await handle.app.evaluate(() => { globalThis.recoveryRestoreSync(); globalThis.recoveryReleaseSync(); });
    await handle.page.waitForFunction(() => window.recoveryForegroundResult?.ok === true);
    await handle.app.evaluate(() => globalThis.recoveryArmSync());
    await beginCheckpoint(handle.page);
    await until(() => handle.app.evaluate(() => globalThis.recoverySyncHeld), Boolean, 'second checkpoint should be inside durable sync');
    const closed = handle.page.waitForEvent('close');
    await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(handle.page.isClosed(), false); assert.deepEqual(await handle.app.evaluate(() => globalThis.recoveryPrompts), []);
    await handle.app.evaluate(() => { globalThis.recoveryRestoreSync(); globalThis.recoveryReleaseSync(); });
    await closed; await handle.app.close().catch(() => {}); running.delete(handle);
    for (const name of ['session.json', 'session.backup.json']) {
      const value = JSON.parse(await readFile(path.join(profile, name), 'utf8'));
      assert.equal(value.documents[0].dirty, false); assert.equal(value.documents[0].draft, undefined, 'pending checkpoint must not resurrect final discard');
    }
    assert.equal(await readFile(file, 'utf8'), original);
    handle = await launch(profile); await assertRecovered(handle, file, original, undefined); await abrupt(handle);
    console.log('PASS close queues during checkpoint and final discard cannot be overwritten');
  }
  console.log('RECOVERY CLOSE PASS: discard, late cancel, closed tabs, missing/external conflicts, and close during durable checkpoint');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const handle of [...running]) await abrupt(handle);
});
