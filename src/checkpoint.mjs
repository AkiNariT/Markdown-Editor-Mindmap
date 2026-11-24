export const MAX_RECOVERY_DOCUMENT_BYTES = 8 * 1024 * 1024;

export function checkpointDraft(text) {
  // UTF-8 takes one to three bytes per UTF-16 code unit. Most drafts need
  // no encoding pass, and oversized text never enters the IPC payload.
  if (text.length > MAX_RECOVERY_DOCUMENT_BYTES ||
      (text.length * 3 > MAX_RECOVERY_DOCUMENT_BYTES && new TextEncoder().encode(text).byteLength > MAX_RECOVERY_DOCUMENT_BYTES)) {
    return { draftTooLarge: true };
  }
  return { draft: text };
}

export function createCheckpointController({ collect, write, onState = () => {}, delay = 500, interval = 2000 }) {
  let stopped = false, pending = false, running = null, timer, signature;
  async function drain() {
    do {
      pending = false;
      if (stopped) break;
      try {
        const value = collect();
        if (value == null) continue;
        const next = JSON.stringify(value);
        if (next === signature) continue;
        onState('saving');
        await write(value);
        signature = next;
        onState('saved');
      } catch (error) { signature = undefined; onState('error', error); }
    } while (pending && !stopped);
  }
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (stopped) return Promise.resolve();
    pending = true;
    if (!running) running = drain().finally(() => { running = null; if (pending && !stopped) return flush(); });
    return running;
  }
  function schedule() {
    if (!stopped && !timer) timer = setTimeout(flush, delay);
  }
  const ticker = interval > 0 ? setInterval(flush, interval) : undefined;
  return { schedule, flush, stop() { stopped = true; clearTimeout(timer); clearInterval(ticker); } };
}
