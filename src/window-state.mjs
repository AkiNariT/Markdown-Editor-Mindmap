import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function rectangle(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e6) || value.width < 1 || value.height < 1) return null;
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(value[key])]));
}
function normalized(value) {
  const bounds = rectangle(value?.bounds);
  return bounds ? { bounds, maximized: value.maximized === true } : null;
}
const intersection = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const distance = (a, b) => (a.x + a.width / 2 - b.x - b.width / 2) ** 2 + (a.y + a.height / 2 - b.y - b.height / 2) ** 2;

// Electron bounds and screen.workArea already use DIP. Never multiply these by
// scaleFactor; that would move and enlarge a restored window on scaled displays.
export function resolveWindowState(saved, displays, primaryId) {
  const screens = (Array.isArray(displays) ? displays : []).map(display => ({ id: display.id, area: rectangle(display.workArea) })).filter(display => display.area);
  if (!screens.length) screens.push({ id: 0, area: { x: 0, y: 0, width: 1180, height: 820 } });
  const previous = normalized(saved);
  let chosen = screens.find(display => display.id === primaryId) || screens[0];
  if (previous) chosen = [...screens].sort((a, b) => intersection(previous.bounds, b.area) - intersection(previous.bounds, a.area) || distance(previous.bounds, a.area) - distance(previous.bounds, b.area))[0];
  const area = chosen.area, minWidth = Math.min(720, area.width), minHeight = Math.min(520, area.height);
  const width = Math.min(area.width, Math.max(minWidth, previous?.bounds.width || 1180));
  const height = Math.min(area.height, Math.max(minHeight, previous?.bounds.height || 820));
  const clamp = (value, start, extent, size) => Math.max(start, Math.min(start + extent - size, value));
  const x = clamp(previous?.bounds.x ?? Math.round(area.x + (area.width - width) / 2), area.x, area.width, width);
  const y = clamp(previous?.bounds.y ?? Math.round(area.y + (area.height - height) / 2), area.y, area.height, height);
  return { bounds: { x, y, width, height }, minWidth, minHeight, maximized: previous?.maximized === true };
}

export function createWindowStateStore(directory) {
  const target = join(directory, 'window-state.json'); let queued = Promise.resolve();
  return {
    async load() {
      await queued;
      try {
        if ((await stat(target)).size > 65536) return null;
        const value = JSON.parse(await readFile(target, 'utf8'));
        return value.version === 1 ? normalized(value) : null;
      } catch { return null; }
    },
    save(value) {
      const state = normalized(value);
      if (!state) return Promise.reject(new Error('窗口位置无效。'));
      const content = JSON.stringify({ version: 1, ...state });
      const operation = queued.then(async () => {
        await mkdir(directory, { recursive: true });
        const temporary = target + '.' + randomUUID() + '.tmp'; let handle;
        try {
          handle = await open(temporary, 'wx', 0o600); await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
          await rename(temporary, target);
        } finally {
          if (handle) await handle.close().catch(() => {});
          await unlink(temporary).catch(() => {});
        }
      });
      queued = operation.catch(() => {}); return operation;
    },
  };
}
