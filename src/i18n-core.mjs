export const languages = Object.freeze(['zh-CN', 'en']);

// Translate only explicitly supplied UI strings; values are never interpreted
// as HTML, translation keys, or replacement patterns.
export function createTranslator(messages) {
  let locale = 'zh-CN';
  const listeners = new Set();
  return {
    getLocale: () => locale,
    setLocale(value) {
      if (!languages.includes(value)) throw new RangeError('Unsupported language: ' + String(value));
      if (value === locale) return;
      locale = value;
      for (const callback of [...listeners]) callback(locale);
    },
    t(message, values = {}) {
      const text = locale === 'en' && Object.hasOwn(messages, message) ? messages[message] : message;
      return String(text).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token);
    },
    onLocaleChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
