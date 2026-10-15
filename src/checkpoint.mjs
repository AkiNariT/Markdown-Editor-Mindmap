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
      } catch (error) { onState('error', error); }
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
