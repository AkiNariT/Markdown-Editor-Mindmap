const repository = 'https://github.com/AkiNariT/Markdown-Editor-Mindmap';
const endpoint = 'https://api.github.com/repos/AkiNariT/Markdown-Editor-Mindmap/releases?per_page=100';
const releasesUrl = `${repository}/releases`;
const maxResponseBytes = 2 * 1024 * 1024;
const maxNotesLength = 16000;

class UpdateError extends Error {}
const fail = code => { throw new UpdateError(code); };

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { version: value.replace(/^v/, ''), core: match.slice(1, 4), prerelease };
}

function compareNumeric(a, b) {
  return a.length - b.length || (a === b ? 0 : a > b ? 1 : -1);
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const result = compareNumeric(a.core[i], b.core[i]);
    if (result) return result;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return compareNumeric(left, right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return a.prerelease.length - b.prerelease.length;
}

function officialUrl(value, expectedPath) {
  if (typeof value !== 'string') fail('UPDATE_RESPONSE');
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
      || decodeURIComponent(url.pathname) !== `/AkiNariT/Markdown-Editor-Mindmap${expectedPath}`) {
      fail('UPDATE_RESPONSE');
    }
    return url.href;
  } catch { fail('UPDATE_RESPONSE'); }
}

function validateRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.draft !== 'boolean' || typeof value.prerelease !== 'boolean'
    || typeof value.tag_name !== 'string') fail('UPDATE_RESPONSE');
  if (value.draft) return null;
  const parsed = parseVersion(value.tag_name);
  if (!parsed) return null;
  const url = officialUrl(value.html_url, `/releases/tag/${value.tag_name}`);
  if (!Array.isArray(value.assets)
    || (value.name != null && typeof value.name !== 'string')
    || (value.body != null && typeof value.body !== 'string')
    || (value.published_at != null && (typeof value.published_at !== 'string'
      || !Number.isFinite(Date.parse(value.published_at))))) fail('UPDATE_RESPONSE');
  const filename = `MD-Windows-x64-${parsed.version}.zip`;
  let hasPackage = false;
  for (const asset of value.assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || typeof asset.name !== 'string' || typeof asset.state !== 'string') fail('UPDATE_RESPONSE');
    if (asset.name !== filename || asset.state !== 'uploaded') continue;
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) fail('UPDATE_RESPONSE');
    if (asset.size === 0) continue;
    officialUrl(asset.browser_download_url, `/releases/download/${value.tag_name}/${filename}`);
    hasPackage = true;
  }
  if (!hasPackage) return null;
  let body = (value.body ?? '').slice(0, maxNotesLength);
  // Avoid splitting a surrogate pair when truncating release notes.
  if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1);
  return {
    parsed,
    release: {
      version: parsed.version,
      url,
      name: value.name || parsed.version,
      body,
      prerelease: value.prerelease,
      publishedAt: value.published_at ?? null,
    },
  };
}

async function readResponse(response, signal, setCancel) {
  if (!response || typeof response.status !== 'number' || !response.headers?.get) fail('UPDATE_RESPONSE');
  if (response.status === 429 || (response.status === 403
    && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after')))) {
    void response.body?.cancel().catch(() => {});
    fail('UPDATE_RATE_LIMIT');
  }
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    fail('UPDATE_HTTP');
  }
  if (Number(response.headers.get('content-length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {});
    fail('UPDATE_RESPONSE');
  }
  if (!response.body?.getReader) fail('UPDATE_RESPONSE');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  setCancel(cancel);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch { fail('UPDATE_NETWORK'); }
      if (signal.aborted) fail('UPDATE_TIMEOUT');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxResponseBytes) fail('UPDATE_RESPONSE');
      try { text += decoder.decode(chunk.value, { stream: true }); } catch { fail('UPDATE_RESPONSE'); }
    }
    try { return JSON.parse(text + decoder.decode()); } catch { fail('UPDATE_RESPONSE'); }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    setCancel(null);
    reader.releaseLock();
  }
}

export function createUpdateChecker({ currentVersion, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
  const installed = parseVersion(currentVersion);
  if (!installed || typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('UPDATE_RESPONSE');
  let releaseUrl = releasesUrl;
  let inFlight = null;

  function check() {
    if (inFlight) return inFlight;
    releaseUrl = releasesUrl;
    const controller = new AbortController();
    let cancelBody = null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new UpdateError('UPDATE_TIMEOUT'));
        controller.abort();
        cancelBody?.();
      }, timeoutMs);
    });
    const run = async () => {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch { fail('UPDATE_NETWORK'); }
      if (controller.signal.aborted) {
        void response?.body?.cancel().catch(() => {});
        fail('UPDATE_TIMEOUT');
      }
      const values = await readResponse(response, controller.signal, cancel => { cancelBody = cancel; });
      if (!Array.isArray(values)) fail('UPDATE_RESPONSE');
      let latest = null;
      for (const value of values) {
        const candidate = validateRelease(value);
        if (candidate && (!latest || compareVersions(candidate.parsed, latest.parsed) > 0)) latest = candidate;
      }
      return {
        status: latest ? (compareVersions(latest.parsed, installed) > 0 ? 'available' : 'current') : 'unpublished',
        currentVersion,
        release: latest?.release ?? null,
      };
    };
    inFlight = Promise.race([run(), timeout]).then(result => {
      releaseUrl = result.release?.url ?? releasesUrl;
      return result;
    }).catch(error => {
      throw error instanceof UpdateError ? error : new UpdateError('UPDATE_RESPONSE');
    }).finally(() => {
      clearTimeout(timer);
      inFlight = null;
    });
    return inFlight;
  }

  return { check, getReleaseUrl: () => releaseUrl };
}
