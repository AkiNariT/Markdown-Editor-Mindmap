import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createTranslator } from '../src/i18n-core.mjs';
import messages from '../src/locales/app.mjs';
import { createWindowsDefaultUI } from '../src/windows-default-ui.mjs';

const opened = { status: 'opened', requiresUserChoice: true, registration: { status: 'registered' }, settings: { status: 'opened' } };
async function fixture(t, api = {}) {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
  t.after(() => dom.window.close());
  const translator = createTranslator(messages);
  const ui = createWindowsDefaultUI({ document: dom.window.document, t: translator.t, api: {
    setWindowsDefaultApp: async () => opened,
    openWindowsDefaultSettings: async () => ({ ...opened, registration: { status: 'skipped' } }),
    copyApplicationPath: async () => ({ status: 'copied' }), ...api,
  } });
  const $ = id => dom.window.document.getElementById(id);
  const click = async id => { $(id).click(); await new Promise(resolve => setImmediate(resolve)); };
  return { ui, $, click, translator, document: dom.window.document };
}

test('successful registration and settings launch still instruct the user to choose defaults', async t => {
  const f = await fixture(t);
  await f.click('default-app');
  assert.match(f.$('default-app-status').textContent, /已打开 Windows 设置/);
  assert.match(f.$('default-app-status').textContent, /请选择 MD/);
  assert.doesNotMatch(f.$('default-app-status').textContent, /已设为|已是默认/);
  assert.equal(f.$('default-app-details').hidden, true);
  assert.equal(f.$('default-app-status').classList.contains('form-error'), false);
});

test('partial registration failure gives a precise cause and keeps manual actions available', async t => {
  const f = await fixture(t, { setWindowsDefaultApp: async () => ({ ...opened, registration: { status: 'failed', code: 'CONFLICT', detail: 'Registration conflict: Applications\\MD.exe' } }) });
  await f.click('default-app');
  assert.match(f.$('default-app-status').textContent, /已打开 Windows 设置/);
  assert.match(f.$('default-app-status').textContent, /自动注册未完成/);
  assert.match(f.$('default-app-cause').textContent, /现有的应用记录/);
  for (const id of ['default-app-settings', 'default-app-copy']) assert.equal(f.$(id).disabled, false);
  await f.click('default-app-copy');
  assert.match(f.$('default-app-copy-status').textContent, /已复制/);
  assert.match(f.$('default-app-cause').textContent, /现有的应用记录/);
  await f.click('default-app-settings');
  assert.match(f.$('default-app-status').textContent, /已打开 Windows 设置/);
  assert.equal(f.$('default-app-cause').hidden, true);
});

test('both failures retain diagnostics as bounded text and provide the manual Settings route', async t => {
  const payload = '<img src=x onerror=alert(1)>\n' + 'x'.repeat(7000);
  const f = await fixture(t, { setWindowsDefaultApp: async () => ({ status: 'failed', requiresUserChoice: true,
    registration: { status: 'failed', code: 'HELPER_MISSING', detail: payload },
    settings: { status: 'failed', code: 'SETTINGS_FAILED', detail: 'Settings launch failed' },
  }) });
  await f.click('default-app');
  assert.match(f.$('default-app-status').textContent, /默认应用/);
  assert.match(f.$('default-app-cause').textContent, /完整解压/);
  assert.equal(f.$('default-app-details').hidden, false);
  assert.match(f.$('default-app-diagnostic').textContent, /<img/);
  assert.match(f.$('default-app-diagnostic').textContent, /Settings launch failed/);
  assert.match(f.$('default-app-diagnostic').textContent, /HELPER_MISSING/);
  assert.match(f.$('default-app-diagnostic').textContent, /SETTINGS_FAILED/);
  assert.ok(f.$('default-app-diagnostic').textContent.length < 5000);
  assert.equal(f.$('default-app-diagnostic').querySelector('img'), null);
});

test('language switching preserves the outcome while retranslating status and recovery actions', async t => {
  const f = await fixture(t, { setWindowsDefaultApp: async () => ({ ...opened, registration: { status: 'failed', code: 'TIMEOUT', detail: 'Timed out' } }) });
  await f.click('default-app');
  f.translator.setLocale('en'); f.ui.refreshLanguage();
  assert.match(f.$('default-app-status').textContent, /Windows Settings is open/);
  assert.match(f.$('default-app-cause').textContent, /timed out/);
  assert.match(f.$('default-app-settings').textContent, /Open Windows Settings/);
  assert.match(f.$('default-app-copy').textContent, /Copy program path/);
  assert.match(f.$('default-app-diagnostic').textContent, /Timed out/);
});

test('async errors restore controls, preserve errors when copying, and respect app locks', async t => {
  let finish;
  const f = await fixture(t, { setWindowsDefaultApp: () => new Promise(resolve => { finish = resolve; }), copyApplicationPath: async () => ({ error: 'Clipboard unavailable' }) });
  await f.click('default-app');
  for (const id of ['default-app', 'default-app-settings', 'default-app-copy']) assert.equal(f.$(id).disabled, true);
  assert.equal(f.$('default-app-status').getAttribute('aria-busy'), 'true');
  finish({ error: 'Unsupported development build' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.$('default-app').disabled, false);
  assert.equal(f.$('default-app-status').getAttribute('aria-busy'), 'false');
  assert.match(f.$('default-app-diagnostic').textContent, /Unsupported development build/);
  await f.click('default-app-copy');
  assert.match(f.$('default-app-copy-status').textContent, /未能复制/);
  assert.match(f.$('default-app-diagnostic').textContent, /Unsupported development build/);
  f.ui.setLocked(true);
  for (const id of ['default-app', 'default-app-settings', 'default-app-copy']) assert.equal(f.$(id).disabled, true);
  f.ui.setLocked(false);
  assert.equal(f.$('default-app-settings').disabled, false);
});

test('registration success with Settings failure is not reported as a registration problem', async t => {
  const f = await fixture(t, { setWindowsDefaultApp: async () => ({ ...opened, status: 'failed', settings: { status: 'failed', code: 'SETTINGS_FAILED' } }) });
  await f.click('default-app');
  assert.match(f.$('default-app-status').textContent, /MD 已注册/);
  assert.match(f.$('default-app-status').textContent, /无法打开/);
  assert.equal(f.$('default-app-cause').hidden, true);
  assert.equal(f.$('default-app-details').hidden, false);
  assert.match(f.$('default-app-diagnostic').textContent, /SETTINGS_FAILED/);
});
