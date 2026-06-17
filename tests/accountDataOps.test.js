/**
 * Tests for fetchAllMyData, checkMyDataExists, and deleteAllMyData in
 * js/profile/api/configs.js. Covers the full lifecycle: fetch data, check
 * counts, delete everything, verify counts are zero.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SUPABASE_URL  = 'https://test.supabase.co';
const ANON_KEY      = 'test-anon-key';
const USER_ID       = 'db94fcf9-0000-0000-0000-fake00000001';
const CLIENT_ID     = 'client-fake-0001';
const ACCESS_TOKEN  = 'tok-fake';
const SESSION       = { access_token: ACCESS_TOKEN };

// Load and eval the two files needed (supabase.js then configs.js), stripping
// ES module import/export syntax so vm.runInContext can execute them.
function loadSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
    .replace(/^import\s.*$/gm, '')
    .replace(/^export\s+(async\s+)?(function|const|let|var|class)\s/gm, '$1$2 ')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '');
}

function makeCtx(fetchMock) {
  const ctx = vm.createContext({
    fetch: fetchMock,
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    console,
  });
  vm.runInContext(loadSrc('js/profile/api/supabase.js'), ctx);
  vm.runInContext(loadSrc('js/profile/api/configs.js'), ctx);
  return ctx;
}

// Build a fetch mock where each call returns ok:true with the given body,
// or optionally map url patterns to specific responses.
function mockFetch(responses = []) {
  return jest.fn(async (url, opts) => {
    const match = responses.find((r) =>
      !r.url || (r.url instanceof RegExp ? r.url.test(url) : url.includes(r.url))
    );
    const status = match?.status ?? 200;
    const body   = match?.body ?? [];
    return {
      ok: status >= 200 && status < 300,
      status,
      json:  async () => body,
      text:  async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  });
}

// Fake rows returned when "data exists" scenario
const FAKE_CONFIG   = { id: 'cfg-1', app_id: 730, proton_pulse_user_id: USER_ID, client_id: CLIENT_ID };
const FAKE_PROTON   = { app_id: 730, proton_pulse_user_id: USER_ID };
const FAKE_SYSTEM   = { device_id: 'dev-1', proton_pulse_user_id: USER_ID };
const FAKE_VOTE     = { id: 'v-1', voter_id: USER_ID };
const FAKE_AVATAR   = { proton_pulse_user_id: USER_ID, display_name: 'Tester' };

function dataExistsFetch() {
  return mockFetch([
    { url: /user_configs\?proton_pulse_user_id/,   body: [FAKE_CONFIG] },
    { url: /user_configs\?client_id/,              body: [] },
    { url: /user_proton_configs/,                  body: [FAKE_PROTON] },
    { url: /user_systems/,                         body: [FAKE_SYSTEM] },
    { url: /report_votes/,                         body: [FAKE_VOTE] },
    { url: /author_avatars/,                       body: [FAKE_AVATAR] },
  ]);
}

function dataGoneFetch() {
  return mockFetch([{ body: [] }]);
}

// ---------------------------------------------------------------------------
// fetchAllMyData
// ---------------------------------------------------------------------------

describe('fetchAllMyData', () => {
  test('fetches all five tables by proton_pulse_user_id', async () => {
    const fetch = dataExistsFetch();
    const ctx = makeCtx(fetch);
    const data = await ctx.fetchAllMyData(USER_ID, null, SESSION);

    expect(data.user_configs).toHaveLength(1);
    expect(data.user_proton_configs).toHaveLength(1);
    expect(data.user_systems).toHaveLength(1);
    expect(data.report_votes).toHaveLength(1);
    expect(data.author_avatars).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('user_configs'), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('user_proton_configs'), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('user_systems'), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('report_votes'), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('author_avatars'), expect.any(Object));
  });

  test('also fetches user_configs by client_id when provided', async () => {
    const fetch = mockFetch([
      { url: /user_configs\?proton_pulse_user_id/, body: [FAKE_CONFIG] },
      { url: /user_configs\?client_id/,            body: [] },
      { url: /.*/,                                  body: [] },
    ]);
    const ctx = makeCtx(fetch);
    await ctx.fetchAllMyData(USER_ID, CLIENT_ID, SESSION);
    const calls = fetch.mock.calls.map(([u]) => u);
    expect(calls.some((u) => u.includes(`client_id=eq.${CLIENT_ID}`))).toBe(true);
  });

  test('deduplicates configs returned by both filters', async () => {
    const fetch = mockFetch([
      { url: /user_configs\?proton_pulse_user_id/, body: [FAKE_CONFIG] },
      { url: /user_configs\?client_id/,            body: [FAKE_CONFIG] }, // same row
      { url: /.*/,                                  body: [] },
    ]);
    const ctx = makeCtx(fetch);
    const data = await ctx.fetchAllMyData(USER_ID, CLIENT_ID, SESSION);
    expect(data.user_configs).toHaveLength(1);
  });

  test('returns empty arrays when no userId or clientId', async () => {
    const fetch = mockFetch();
    const ctx = makeCtx(fetch);
    const data = await ctx.fetchAllMyData(null, null, SESSION);
    expect(data.user_configs).toHaveLength(0);
    expect(data.user_proton_configs).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('sends user access token in Authorization header', async () => {
    const fetch = dataExistsFetch();
    const ctx = makeCtx(fetch);
    await ctx.fetchAllMyData(USER_ID, null, SESSION);
    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});

// ---------------------------------------------------------------------------
// checkMyDataExists
// ---------------------------------------------------------------------------

describe('checkMyDataExists', () => {
  test('returns non-zero counts when rows exist', async () => {
    const ctx = makeCtx(dataExistsFetch());
    const counts = await ctx.checkMyDataExists(USER_ID, null, SESSION);
    expect(counts.user_configs).toBe(1);
    expect(counts.user_proton_configs).toBe(1);
    expect(counts.user_systems).toBe(1);
    expect(counts.report_votes).toBe(1);
    expect(counts.author_avatars).toBe(1);
  });

  test('returns all zeros when no rows exist', async () => {
    const ctx = makeCtx(dataGoneFetch());
    const counts = await ctx.checkMyDataExists(USER_ID, null, SESSION);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteAllMyData
// ---------------------------------------------------------------------------

describe('deleteAllMyData', () => {
  test('sends DELETE to all five endpoints for protonPulseUserId', async () => {
    const fetch = mockFetch();
    const ctx = makeCtx(fetch);
    await ctx.deleteAllMyData(USER_ID, null, SESSION);

    const calls = fetch.mock.calls.map(([u, o]) => ({ u, method: o.method }));
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes.some((c) => c.u.includes('user_configs') && c.u.includes(USER_ID))).toBe(true);
    expect(deletes.some((c) => c.u.includes('user_proton_configs') && c.u.includes(USER_ID))).toBe(true);
    expect(deletes.some((c) => c.u.includes('user_systems') && c.u.includes(USER_ID))).toBe(true);
    expect(deletes.some((c) => c.u.includes('report_votes') && c.u.includes(USER_ID))).toBe(true);
    expect(deletes.some((c) => c.u.includes('author_avatars') && c.u.includes(USER_ID))).toBe(true);
    expect(deletes).toHaveLength(5);
  });

  test('also sends DELETE to user_configs by client_id when provided', async () => {
    const fetch = mockFetch();
    const ctx = makeCtx(fetch);
    await ctx.deleteAllMyData(USER_ID, CLIENT_ID, SESSION);

    const calls = fetch.mock.calls.map(([u, o]) => ({ u, method: o.method }));
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes.some((c) => c.u.includes('user_configs') && c.u.includes(`client_id=eq.${CLIENT_ID}`))).toBe(true);
    expect(deletes).toHaveLength(6);
  });

  test('skips all deletes when no userId or clientId', async () => {
    const fetch = mockFetch();
    const ctx = makeCtx(fetch);
    await ctx.deleteAllMyData(null, null, SESSION);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('throws when a DELETE returns non-ok', async () => {
    const fetch = mockFetch([{ url: /user_systems/, status: 403 }]);
    const ctx = makeCtx(fetch);
    await expect(ctx.deleteAllMyData(USER_ID, null, SESSION)).rejects.toThrow('Delete failed');
  });

  test('sends Prefer: return=minimal header', async () => {
    const fetch = mockFetch();
    const ctx = makeCtx(fetch);
    await ctx.deleteAllMyData(USER_ID, null, SESSION);
    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Prefer).toBe('return=minimal');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: fake user exists -> check -> delete -> verify gone
// ---------------------------------------------------------------------------

describe('account data lifecycle', () => {
  test('data exists, gets deleted, then check returns zero', async () => {
    // Phase 1: data exists
    const checkBeforeFetch = dataExistsFetch();
    const ctxBefore = makeCtx(checkBeforeFetch);
    const countsBefore = await ctxBefore.checkMyDataExists(USER_ID, CLIENT_ID, SESSION);
    const totalBefore = Object.values(countsBefore).reduce((a, b) => a + b, 0);
    expect(totalBefore).toBeGreaterThan(0);

    // Phase 2: delete
    const deleteFetch = mockFetch();
    const ctxDelete = makeCtx(deleteFetch);
    await expect(ctxDelete.deleteAllMyData(USER_ID, CLIENT_ID, SESSION)).resolves.toBeUndefined();

    // Phase 3: check again -- all zeros
    const checkAfterFetch = dataGoneFetch();
    const ctxAfter = makeCtx(checkAfterFetch);
    const countsAfter = await ctxAfter.checkMyDataExists(USER_ID, CLIENT_ID, SESSION);
    const totalAfter = Object.values(countsAfter).reduce((a, b) => a + b, 0);
    expect(totalAfter).toBe(0);
  });
});
