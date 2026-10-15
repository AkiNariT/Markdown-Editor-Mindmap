import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../src/i18n-core.mjs';

test('Chinese default, English selection, fallback and strict locale validation', () => {
  const i18n = createTranslator({ '保存': 'Save' });
  assert.equal(i18n.getLocale(), 'zh-CN');
  assert.equal(i18n.t('保存'), '保存');
  i18n.setLocale('en');
  assert.equal(i18n.t('保存'), 'Save');
  assert.equal(i18n.t('Untranslated diagnostic'), 'Untranslated diagnostic');
  assert.throws(() => i18n.setLocale('fr'), /Unsupported language/);
  assert.equal(i18n.getLocale(), 'en');
});

test('named values remain literal and are interpolated once in either language', () => {
  const i18n = createTranslator({ '关闭「{name}」？': 'Close “{name}”?' });
  const name = '<b>$& {name} 中文.md';
  assert.equal(i18n.t('关闭「{name}」？', { name }), '关闭「' + name + '」？');
  i18n.setLocale('en');
  assert.equal(i18n.t('关闭「{name}」？', { name }), 'Close “' + name + '”?');
  assert.equal(i18n.t('{missing} {count}', { count: 0 }), '{missing} 0');
  assert.equal(i18n.t('{constructor} {toString}'), '{constructor} {toString}');
});

test('locale subscriptions only notify on changes and can be removed', () => {
  const i18n = createTranslator({}); const calls = [];
  const stop = i18n.onLocaleChange(locale => calls.push(locale));
  i18n.setLocale('zh-CN'); i18n.setLocale('en'); i18n.setLocale('en');
  stop(); stop(); i18n.setLocale('zh-CN');
  assert.deepEqual(calls, ['en']);
});
