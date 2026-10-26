import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateChecker } from '../src/updates.mjs';

const repository = 'https://github.com/AkiNariT/Markdown-Editor-Mindmap';

function release(tag = 'v0.1.23', overrides = {}) {
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    html_url: `${repository}/releases/tag/${tag}`,
    name: `MD ${version}`,
    body: 'Update notes',
    draft: false,
    prerelease: true,
    published_at: '2026-10-15T00:00:00Z',
    assets: [{
      name: `MD-Windows-x64-${version}.zip`,
      state: 'uploaded',
      size: 1024,
      browser_download_url: `${repository}/releases/download/${tag}/MD-Windows-x64-${version}.zip`,
    }],
    ...overrides,
  };
}

function jsonResponse(value, options = {}) {
  return new Response(JSON.stringify(value), { status: 200, ...options });
}

test('finds a public preview with a downloadable Windows package', async () => {
  const checker = createUpdateChecker({
    platform: 'win32', arch: 'x64',
    currentVersion: '0.1.22',
    fetchImpl: async () => jsonResponse([release()]),
  });
  assert.deepEqual(await checker.check(), {
    status: 'available',
    currentVersion: '0.1.22',
    release: {
      version: '0.1.23',
      url: `${repository}/releases/tag/v0.1.23`,
      name: 'MD 0.1.23',
      body: 'Update notes',
      prerelease: true,
      publishedAt: '2026-10-15T00:00:00Z',
    },
  });
});

function checkerFor(releases, options = {}) {
  return createUpdateChecker({
    platform: 'win32', arch: 'x64',
    currentVersion: '0.1.22',
    fetchImpl: async () => jsonResponse(releases),
    ...options,
  });
}

function platformRelease(tag, platform, arch) {
  const candidate = release(tag);
  const filename = `MD-${platform}-${arch}-${tag.replace(/^v/, '')}.zip`;
  candidate.assets[0].name = filename;
  candidate.assets[0].browser_download_url = `${repository}/releases/download/${tag}/${filename}`;
  return candidate;
}

for (const [platform, arch, expectedVersion] of [['win32', 'x64', '0.1.23'], ['darwin', 'arm64', '0.1.24'], ['darwin', 'x64', '0.1.25']]) {
  test(`update selection requires an uploaded package for ${platform}/${arch}`, async () => {
    const result = await checkerFor([
      platformRelease('v0.1.23', 'Windows', 'x64'),
      platformRelease('v0.1.24', 'macOS', 'arm64'),
      platformRelease('v0.1.25', 'macOS', 'x64'),
    ], { platform, arch }).check();
    assert.equal(result.status, 'available');
    assert.equal(result.release.version, expectedVersion);
  });
}

test('Mac checker never offers Windows or a different Mac architecture package', async () => {
  const result = await checkerFor([release(), platformRelease('v0.1.24', 'macOS', 'x64')], { platform: 'darwin', arch: 'arm64' }).check();
  assert.equal(result.status, 'unpublished');
  assert.equal(result.release, null);
});

test('unknown platform and architecture never fall back to Windows downloads', async () => {
  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'arm64'], ['darwin', 'ia32']]) {
    assert.equal((await checkerFor([release()], { platform, arch }).check()).status, 'unpublished');
  }
});

test('Mac package still requires an official matching download URL', async () => {
  const candidate = platformRelease('v0.1.24', 'macOS', 'arm64');
  candidate.assets[0].browser_download_url = 'https://example.com/MD-macOS-arm64-0.1.24.zip';
  await assert.rejects(checkerFor([candidate], { platform: 'darwin', arch: 'arm64' }).check(), /UPDATE_RESPONSE/);
});

test('requests only the fixed public endpoint without credentials or redirects', async () => {
  let request;
  const checker = checkerFor([], {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse([]);
    },
  });
  await checker.check();
  assert.equal(request.url, 'https://api.github.com/repos/AkiNariT/Markdown-Editor-Mindmap/releases?per_page=100');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.body, undefined);
  assert.ok(request.options.signal instanceof AbortSignal);
  const headers = new Headers(request.options.headers);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
});

test('selects the highest numeric version regardless of feed ordering', async () => {
  const result = await checkerFor([
    release('v0.1.9'), release('v0.1.22'), release('v0.1.100'), release('v0.1.30'),
  ]).check();
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '0.1.100');
});

for (const [currentVersion, tag, expected] of [
  ['0.1.23', 'v0.1.23', 'current'],
  ['0.2.0', 'v0.1.23', 'current'],
  ['v0.1.22', '0.1.23', 'available'],
  ['1.0.0-rc.9', 'v1.0.0-rc.10', 'available'],
  ['1.0.0-rc.10', 'v1.0.0-rc.9', 'current'],
  ['1.0.0-1', 'v1.0.0-alpha', 'available'],
  ['1.0.0-alpha', 'v1.0.0-alpha.1', 'available'],
  ['1.0.0-rc.1', 'v1.0.0', 'available'],
  ['1.0.0', 'v1.0.0-rc.1', 'current'],
  ['1.0.0+build.1', 'v1.0.0+build.99', 'current'],
  ['9007199254740992.0.0', 'v9007199254740993.0.0', 'available'],
]) {
  test(`compares ${currentVersion} with ${tag} as ${expected}`, async () => {
    const result = await checkerFor([release(tag)], { currentVersion }).check();
    assert.equal(result.status, expected);
    assert.equal(result.currentVersion, currentVersion);
  });
}

for (const tag of ['1.0', '01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+', '1.0.0-rc..1', 'v1.0.0/evil', '1.0.0\n']) {
  test(`ignores non-semver release tag ${tag}`, async () => {
    assert.deepEqual(await checkerFor([release(tag)]).check(), {
      status: 'unpublished', currentVersion: '0.1.22', release: null,
    });
  });
}

test('rejects invalid installed versions instead of claiming current', () => {
  for (const currentVersion of ['', '0.1', '01.0.0', '1.0.0-01', '1.0.0\n', null]) {
    assert.throws(() => checkerFor([], { currentVersion }), /UPDATE_RESPONSE/);
  }
});

test('empty and unsuitable feeds report unpublished', async () => {
  const pending = release('v3.0.0');
  pending.assets[0].state = 'new';
  const wrongArchitecture = release('v2.0.0');
  wrongArchitecture.assets[0].name = 'MD-Windows-arm64-2.0.0.zip';
  for (const releases of [[], [release('v9.0.0', { draft: true })], [release('v1.0.0', { assets: [] })], [pending], [wrongArchitecture]]) {
    assert.deepEqual(await checkerFor(releases).check(), {
      status: 'unpublished', currentVersion: '0.1.22', release: null,
    });
  }
});

test('uses the latest complete package while a newer release is still uploading', async () => {
  const result = await checkerFor([release('v0.1.25', { assets: [] }), release('v0.1.24')]).check();
  assert.equal(result.release.version, '0.1.24');
});

test('does not offer a zero-byte Windows package as an available update', async () => {
  const emptyPackage = release('v0.1.24');
  emptyPackage.assets[0].size = 0;
  assert.deepEqual(await checkerFor([emptyPackage]).check(), {
    status: 'unpublished', currentVersion: '0.1.22', release: null,
  });
  const result = await checkerFor([emptyPackage, release('v0.1.23')]).check();
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '0.1.23');
});

for (const size of [undefined, null, -1, '1024', 1.5]) {
  test(`rejects a Windows package with invalid size ${JSON.stringify(size)}`, async () => {
    const candidate = release();
    candidate.assets[0].size = size;
    await assert.rejects(checkerFor([candidate]).check(), { message: 'UPDATE_RESPONSE' });
  });
}

for (const badUrl of [
  'https://evil.example/releases/tag/v0.1.23',
  'https://github.com.evil.example/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23',
  'https://github.com/other/project/releases/tag/v0.1.23',
  'https://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.24',
  `${repository}/releases/tag/v0.1.23?redirect=evil`,
  `${repository}/releases/tag/v0.1.23#evil`,
  'https://user@github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23',
  'http://github.com/AkiNariT/Markdown-Editor-Mindmap/releases/tag/v0.1.23',
  'javascript:alert(1)',
]) {
  test(`rejects unsafe release page ${badUrl}`, async () => {
    const checker = checkerFor([release('v0.1.23', { html_url: badUrl })]);
    await assert.rejects(checker.check(), /UPDATE_RESPONSE/);
    assert.equal(checker.getReleaseUrl(), `${repository}/releases`);
  });
}

test('rejects a Windows package with a mismatched or hostile download URL', async () => {
  for (const badUrl of [
    'https://evil.example/MD-Windows-x64-0.1.23.zip',
    `${repository}/releases/download/v0.1.22/MD-Windows-x64-0.1.23.zip`,
    `${repository}/releases/download/v0.1.23/other.zip`,
  ]) {
    const candidate = release();
    candidate.assets[0].browser_download_url = badUrl;
    await assert.rejects(checkerFor([candidate]).check(), /UPDATE_RESPONSE/);
  }
});

test('accepts URL-encoded semver build metadata from GitHub', async () => {
  const candidate = release('v1.0.0+build.1');
  candidate.html_url = candidate.html_url.replace('+', '%2B');
  candidate.assets[0].browser_download_url = candidate.assets[0].browser_download_url.replaceAll('+', '%2B');
  assert.equal((await checkerFor([candidate]).check()).release.version, '1.0.0+build.1');
});

for (const value of [
  null, {}, { message: 'error' }, [null], [{}],
  [release('v0.1.23', { draft: 'false' })],
  [release('v0.1.23', { prerelease: 'true' })],
  [release('v0.1.23', { assets: null })],
  [release('v0.1.23', { assets: [null] })],
  [release('v0.1.23', { body: {} })],
  [release('v0.1.23', { published_at: 'not a date' })],
  [release(), {}],
]) {
  test(`rejects malformed release data ${JSON.stringify(value).slice(0, 100)}`, async () => {
    await assert.rejects(checkerFor(value).check(), /UPDATE_RESPONSE/);
  });
}

test('limits release notes and supports missing optional text fields', async () => {
  const long = await checkerFor([release('v0.1.23', { body: '中'.repeat(17000) })]).check();
  assert.equal(long.release.body.length, 16000);
  const absent = await checkerFor([release('v0.1.23', { body: null, name: null, published_at: null })]).check();
  assert.equal(absent.release.body, '');
  assert.equal(absent.release.name, '0.1.23');
  assert.equal(absent.release.publishedAt, null);
});

test('resets to the official releases list after a failed check', async () => {
  let response = jsonResponse([release()]);
  const checker = checkerFor([], { fetchImpl: async () => response });
  assert.equal(checker.getReleaseUrl(), `${repository}/releases`);
  await checker.check();
  assert.equal(checker.getReleaseUrl(), `${repository}/releases/tag/v0.1.23`);
  response = jsonResponse([release('v0.1.24', { html_url: 'https://evil.example' })]);
  await assert.rejects(checker.check(), /UPDATE_RESPONSE/);
  assert.equal(checker.getReleaseUrl(), `${repository}/releases`);
  response = jsonResponse([release('v0.1.22')]);
  assert.equal((await checker.check()).status, 'current');
  assert.equal(checker.getReleaseUrl(), `${repository}/releases/tag/v0.1.22`);
});

test('shares one in-flight request and permits a fresh check after it finishes', async () => {
  let resolveFetch;
  let calls = 0;
  const checker = checkerFor([], { fetchImpl: () => {
    calls += 1;
    return new Promise(resolve => { resolveFetch = resolve; });
  } });
  const first = checker.check();
  const second = checker.check();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveFetch(jsonResponse([release()]));
  assert.equal((await first).status, 'available');
  const third = checker.check();
  assert.notEqual(third, first);
  assert.equal(calls, 2);
  resolveFetch(jsonResponse([release('v0.1.24')]));
  assert.equal((await third).release.version, '0.1.24');
});

for (const [status, headers, code] of [
  [429, {}, 'UPDATE_RATE_LIMIT'],
  [403, { 'x-ratelimit-remaining': '0' }, 'UPDATE_RATE_LIMIT'],
  [403, { 'retry-after': '60' }, 'UPDATE_RATE_LIMIT'],
  [403, {}, 'UPDATE_HTTP'],
  [404, {}, 'UPDATE_HTTP'],
  [500, {}, 'UPDATE_HTTP'],
]) {
  test(`maps HTTP ${status} ${JSON.stringify(headers)} to ${code}`, async () => {
    await assert.rejects(checkerFor([], {
      fetchImpl: async () => jsonResponse({ message: 'Request failed' }, { status, headers }),
    }).check(), { message: code });
  });
}

test('maps fetch failures without exposing arbitrary error details and permits retry', async () => {
  let failed = true;
  const checker = checkerFor([], { fetchImpl: async () => {
    if (failed) throw new Error('Sensitive proxy details');
    return jsonResponse([release()]);
  } });
  await assert.rejects(checker.check(), { message: 'UPDATE_NETWORK' });
  failed = false;
  assert.equal((await checker.check()).status, 'available');
});

test('rejects broken JSON and invalid response text as response errors', async () => {
  for (const body of ['{bad json', new Uint8Array([0xff])]) {
    await assert.rejects(checkerFor([], {
      fetchImpl: async () => new Response(body),
    }).check(), { message: 'UPDATE_RESPONSE' });
  }
});

test('rejects response bodies above 2 MiB with or without Content-Length', async () => {
  const oversized = JSON.stringify([release('v0.1.23', { body: '中'.repeat(800000) })]);
  for (const headers of [{}, { 'content-length': '2097153' }]) {
    await assert.rejects(checkerFor([], {
      fetchImpl: async () => new Response(oversized, { headers }),
    }).check(), { message: 'UPDATE_RESPONSE' });
  }
});

test('classifies response stream failures as network errors', async () => {
  const body = new ReadableStream({ start(controller) { controller.error(new Error('connection closed')); } });
  await assert.rejects(checkerFor([], {
    fetchImpl: async () => new Response(body),
  }).check(), { message: 'UPDATE_NETWORK' });
});

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('TEST_WAIT_EXPIRED')), 250);
    })]);
  } finally { clearTimeout(timer); }
}

test('times out a stalled fetch even if its implementation ignores abort', async () => {
  let signal;
  const checker = checkerFor([], { timeoutMs: 15, fetchImpl: (_, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(deadline(checker.check()), { message: 'UPDATE_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('keeps the timeout active while reading the response body', async () => {
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const checker = checkerFor([], { timeoutMs: 15, fetchImpl: async () => new Response(body) });
  await assert.rejects(deadline(checker.check()), { message: 'UPDATE_TIMEOUT' });
  assert.equal(canceled, true);
});
