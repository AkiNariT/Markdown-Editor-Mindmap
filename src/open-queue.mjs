import { resolve } from 'node:path';

export function parseOpenArguments(argv, cwd) {
  const files = []; let afterSeparator = false;
  for (const argument of Array.isArray(argv) ? argv : []) {
    if (argument === '--') { afterSeparator = true; continue; }
    if (typeof argument !== 'string' || argument.includes('\0') || (!afterSeparator && argument.startsWith('-')) || !/\.(?:md|markdown|mdmap)$/i.test(argument)) continue;
    files.push(resolve(cwd || process.cwd(), argument));
  }
  return files;
}

export function createOpenQueue({ open, canRun = () => true, onError = () => {} }) {
  const waiting = []; let running = null;
  function drain() {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      while (waiting.length && canRun()) {
        const file = waiting.shift();
        try { await open(file); }
        catch (error) { try { await onError(error, file); } catch { /* Reporting must not discard later files. */ } }
      }
    }).finally(() => { running = null; if (waiting.length && canRun()) return drain(); });
    return running;
  }
  return {
    enqueue(files) { for (const file of files) if (typeof file === 'string' && file) waiting.push(file); void drain(); },
    drain,
    get size() { return waiting.length; },
  };
}
