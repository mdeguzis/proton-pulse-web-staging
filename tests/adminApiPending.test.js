/**
 * Behavioral tests for js/admin/api/pending.js loaded via require().
 *
 * Covers fetchPendingReports (filter by missing/mismatched approval
 * hash), approveReport (POST + hash payload), and the internal md5
 * implementation by way of round-trip equality.
 */

global.window = global;
global.window.SUPABASE_URL = 'https://test.supabase.co';
global.window.SUPABASE_ANON_KEY = 'test-anon-key';
const { fetchPendingReports, approveReport } = require('../js/admin/api/pending.js');

const session = { access_token: 'tok' };

function routedFetch(routes) {
  return jest.fn(async (url, init) => {
    const entry = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!entry) return { ok: true, json: async () => [] };
    const v = typeof entry[1] === 'function' ? entry[1](url, init) : entry[1];
    if (v && typeof v === 'object' && v.__http) return v.__http;
    return { ok: true, json: async () => v };
  });
}

// Mirror the file's own md5 input layout so we can predict the hash
// without re-importing computeHash (it's not exported). compute it via
// approveReport's POST body for the assertions.
function reportRow(overrides = {}) {
  return {
    id: 42,
    app_id: '730',
    client_id: 'client-7',
    rating: 'gold',
    notes: 'runs ok',
    os: 'SteamOS',
    gpu: 'AMD',
    created_at: '2026-06-29T22:57:07.752066+00:00',
    proton_version: 'Proton 9.0',
    cpu: 'AMD Ryzen',
    gpu_driver: '',
    gpu_vendor: 'amd',
    gpu_architecture: 'gfx10',
    ram: '16G',
    vram_mb: 8192,
    kernel: '6.1',
    duration: 'longGame',
    duration_minutes: 240,
    form_responses: {},
    config_key: '',
    game_owned: true,
    source: 'web-linux',
    updated_at: '2026-06-29T22:57:07.752066+00:00',
    title: 'Hl2',
    ...overrides,
  };
}

describe('fetchPendingReports', () => {
  test('keeps a report that has no approval row', async () => {
    const row = reportRow({ id: 99 });
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/user_configs': [row],
      'https://test.supabase.co/rest/v1/report_approvals': [],
    });
    const result = await fetchPendingReports(session);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99);
    expect(typeof result[0]._approval_hash).toBe('string');
    expect(result[0]._approval_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  test('keeps a report whose stored hash does not match the live content', async () => {
    const row = reportRow({ id: 5 });
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/user_configs': [row],
      'https://test.supabase.co/rest/v1/report_approvals': [
        { report_id: 5, approval_hash: 'deadbeef' },
      ],
    });
    const result = await fetchPendingReports(session);
    expect(result.map((r) => r.id)).toEqual([5]);
  });

  test('drops a report whose stored hash matches the live content', async () => {
    // Compute the expected hash via approveReport first, then feed it
    // back as the stored hash so the row is "already approved".
    const row = reportRow({ id: 11 });
    let postedHash = null;
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/report_approvals?on_conflict=report_id': (_url, init) => {
        postedHash = JSON.parse(init.body).approval_hash;
        return { __http: { ok: true, json: async () => [] } };
      },
    });
    await approveReport(session, row);
    expect(postedHash).toMatch(/^[0-9a-f]{32}$/);

    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/user_configs': [row],
      'https://test.supabase.co/rest/v1/report_approvals': [
        { report_id: 11, approval_hash: postedHash },
      ],
    });
    const result = await fetchPendingReports(session);
    expect(result).toHaveLength(0);
  });

  test('throws on a non-ok report fetch', async () => {
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/user_configs': { __http: { ok: false, status: 503 } },
    });
    await expect(fetchPendingReports(session)).rejects.toThrow(/Failed to fetch reports: 503/);
  });

  test('treats a non-ok approvals fetch as "no approvals" rather than throwing', async () => {
    const row = reportRow({ id: 1 });
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/user_configs': [row],
      'https://test.supabase.co/rest/v1/report_approvals': { __http: { ok: false, status: 500 } },
    });
    const result = await fetchPendingReports(session);
    expect(result).toHaveLength(1);
  });
});

describe('approveReport', () => {
  test('POSTs to report_approvals with hash + approved_at=now + admin author', async () => {
    let captured = null;
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/report_approvals?on_conflict=report_id': (_url, init) => {
        captured = init;
        return { __http: { ok: true, json: async () => [] } };
      },
    });
    await approveReport(session, reportRow({ id: 5 }));
    expect(captured.method).toBe('POST');
    expect(captured.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    const body = JSON.parse(captured.body);
    expect(body).toEqual({
      report_id: 5,
      approval_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
      approved_at: expect.any(String),
      approved_by: 'admin',
    });
    expect(Array.isArray(body)).toBe(false);
    // approved_at should be a valid ISO timestamp.
    expect(new Date(body.approved_at).toString()).not.toBe('Invalid Date');
  });

  test('throws on non-ok response', async () => {
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/report_approvals': { __http: { ok: false, status: 403 } },
    });
    await expect(approveReport(session, reportRow())).rejects.toThrow(/Approve failed: 403/);
  });

  test('two edits to the same row yield different hashes', async () => {
    const hashes = [];
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/report_approvals?on_conflict=report_id': (_url, init) => {
        hashes.push(JSON.parse(init.body).approval_hash);
        return { __http: { ok: true, json: async () => [] } };
      },
    });
    await approveReport(session, reportRow({ id: 1, notes: 'first' }));
    await approveReport(session, reportRow({ id: 1, notes: 'second' }));
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  test('equal content yields equal hashes (md5 determinism)', async () => {
    const hashes = [];
    global.fetch = routedFetch({
      'https://test.supabase.co/rest/v1/report_approvals?on_conflict=report_id': (_url, init) => {
        hashes.push(JSON.parse(init.body).approval_hash);
        return { __http: { ok: true, json: async () => [] } };
      },
    });
    await approveReport(session, reportRow({ id: 1, notes: 'same' }));
    await approveReport(session, reportRow({ id: 1, notes: 'same' }));
    expect(hashes[0]).toBe(hashes[1]);
  });
});
