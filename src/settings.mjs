import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { t } from './i18n.mjs';

const supported = language => language === 'zh-CN' || language === 'en';

export function createSettingsStore(directory) {
  const target = join(directory, 'settings.json');
  let queued = Promise.resolve();
  return {
    async load() {
      await queued;
      try {
        if ((await stat(target)).size > 65536) return { language: 'zh-CN' };
        const value = JSON.parse(await readFile(target, 'utf8'));
        if (value?.version === 1 && supported(value.language)) return { language: value.language };
      } catch { /* Missing or unusable preferences cannot prevent startup. */ }
      return { language: 'zh-CN' };
    },
    setLanguage(language) {
      if (!supported(language)) return Promise.reject(new Error(t('请选择中文或 English。')));
      const content = JSON.stringify({ version: 1, language });
      const operation = queued.then(async () => {
        await mkdir(directory, { recursive: true });
        const temporary = target + '.' + randomUUID() + '.tmp';
        let handle;
        try {
          handle = await open(temporary, 'wx', 0o600);
          await handle.writeFile(content, 'utf8'); await handle.sync();
          await handle.close(); handle = null;
          await rename(temporary, target);
        } finally {
          if (handle) await handle.close().catch(() => {});
          await unlink(temporary).catch(() => {});
        }
        return { language };
      });
      queued = operation.catch(() => {});
      return operation;
    },
  };
}
