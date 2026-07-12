/**
 * Vendor status feed integration for status.html (#278).
 *
 * The vendor-status.js module fetches GitHub Pages component health from
 * githubstatus.com and the Cloudflare overall indicator from
 * cloudflarestatus.com and reshapes both into the same card contract the
 * Supabase edge-fn cards use. These tests exercise the pure mapping
 * helpers plus the fetch integration with global.fetch stubbed.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const HTML      = fs.readFileSync(path.join(ROOT, 'status.html'), 'utf8');
const MAIN      = fs.readFileSync(path.join(ROOT, 'js', 'status', 'main.js'), 'utf8');
const VENDOR    = fs.readFileSync(path.join(ROOT, 'js', 'status', 'vendor-status.js'), 'utf8');
const MANIFEST  = fs.readFileSync(path.join(ROOT, 'gh-pages-manifest.txt'), 'utf8').split('\n').map(l => l.trim());

const { loadEsm } = require('./_esm-vm.js');

function loadVendor(ctxExtra = {}) {
  const ctx = {
    console: { debug: () => {}, warn: () => {}, log: () => {} },
    Date,
    Promise,
    Array,
    Error,
    Number,
    String,
    JSON,
    Boolean,
    ...ctxExtra,
  };
  loadEsm(['js/status/vendor-status.js'], ctx);
  return ctx;
}

describe('status.html vendor infrastructure wiring', () => {
  test('page wording no longer claims GitHub Actions checks the feeds', () => {
    // Migrated to a Cloudflare Worker cron in #275; the old prose was
    // wrong the moment that landed. Regression pin.
    expect(HTML).not.toMatch(/GitHub Actions job/);
    expect(HTML).toMatch(/Cloudflare Worker cron/);
  });

  test('vendor list container is above the Supabase edge-fn list', () => {
    expect(HTML).toContain('id="status-vendor-list"');
    expect(HTML).toContain('id="status-list"');
    const vendorAt = HTML.indexOf('id="status-vendor-list"');
    const supaAt   = HTML.indexOf('id="status-list"');
    expect(vendorAt).toBeGreaterThan(-1);
    expect(supaAt).toBeGreaterThan(vendorAt);
  });

  test('both status sections are labeled so they read as peers', () => {
    expect(HTML).toContain('Upstream infrastructure');
    expect(HTML).toContain('Supabase edge functions');
  });

  test('main.js imports the vendor helper + wires the refresh interval', () => {
    expect(MAIN).toMatch(/import\s*\{\s*fetchVendorStatuses,\s*VENDOR_REFRESH_MS\s*\}\s*from\s*'\.\/vendor-status\.js/);
    expect(MAIN).toMatch(/loadAndRenderVendor\(\)/);
    expect(MAIN).toMatch(/setInterval\(loadAndRenderVendor, VENDOR_REFRESH_MS\)/);
  });

  test('vendor cards render as anchors to the vendor status page', () => {
    // A modal on a vendor row would just show the JSON blob; sending the
    // reader to the vendor status page is more useful, so vendor cards
    // are anchors with a new-tab target.
    expect(MAIN).toMatch(/status-card--vendor/);
    expect(MAIN).toMatch(/target="_blank"/);
    expect(MAIN).toMatch(/svc\.vendor_status_url/);
  });

  test('gh-pages-manifest.txt lists the new vendor-status module', () => {
    expect(MANIFEST).toContain('js/status/vendor-status.js');
  });
});

describe('vendor-status pure mappers', () => {
  test('componentStatusToState covers every Statuspage.io state', () => {
    const { componentStatusToState } = loadVendor();
    expect(componentStatusToState('operational')).toBe('operational');
    expect(componentStatusToState('degraded_performance')).toBe('degraded');
    expect(componentStatusToState('partial_outage')).toBe('degraded');
    expect(componentStatusToState('under_maintenance')).toBe('degraded');
    expect(componentStatusToState('major_outage')).toBe('down');
    expect(componentStatusToState('something_new')).toBe('unknown');
    expect(componentStatusToState(undefined)).toBe('unknown');
  });

  test('overallIndicatorToState maps every documented indicator', () => {
    const { overallIndicatorToState } = loadVendor();
    expect(overallIndicatorToState('none')).toBe('operational');
    expect(overallIndicatorToState('minor')).toBe('degraded');
    expect(overallIndicatorToState('maintenance')).toBe('degraded');
    expect(overallIndicatorToState('major')).toBe('down');
    expect(overallIndicatorToState('critical')).toBe('down');
    expect(overallIndicatorToState('bogus')).toBe('unknown');
  });

  test('GitHub Pages component id is pinned to the well-known Statuspage.io id', () => {
    // The id vg70hn9s2tyj is the public GitHub Pages component; if it
    // ever gets rotated the row silently reads as "unknown", so pin it
    // here so the change is deliberate.
    expect(VENDOR).toContain("'vg70hn9s2tyj'");
  });
});

describe('vendor-status fetch integration', () => {
  const OK_GH_COMPONENTS = {
    components: [
      { id: 'other', name: 'Actions', status: 'operational' },
      { id: 'vg70hn9s2tyj', name: 'Pages', status: 'operational', updated_at: '2026-07-11T20:00:00Z' },
    ],
  };
  const DEGRADED_GH_COMPONENTS = {
    components: [
      { id: 'vg70hn9s2tyj', name: 'Pages', status: 'degraded_performance', updated_at: '2026-07-11T20:00:00Z' },
    ],
  };
  const OK_CF_STATUS = { status: { indicator: 'none', description: 'All Systems Operational' } };
  const MAJOR_CF_STATUS = { status: { indicator: 'major', description: 'Cloudflare CDN degraded' } };

  function stubFetch(routes) {
    return jest.fn((url) => {
      for (const [pattern, resp] of routes) {
        if (String(url).includes(pattern)) {
          return Promise.resolve({
            ok: resp.ok !== false,
            status: resp.status || 200,
            json: () => Promise.resolve(resp.body),
          });
        }
      }
      return Promise.reject(new Error(`no stub for ${url}`));
    });
  }

  test('both feeds operational returns two cards with status "operational"', async () => {
    const { fetchVendorStatuses } = loadVendor({ fetch: stubFetch([
      ['githubstatus.com', { body: OK_GH_COMPONENTS }],
      ['cloudflarestatus.com', { body: OK_CF_STATUS }],
    ]) });
    const cards = await fetchVendorStatuses();
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ name: 'GitHub Pages', status: 'operational', http_status: 200 });
    expect(cards[1]).toMatchObject({ name: 'Cloudflare (overall)', status: 'operational', http_status: 200 });
  });

  test('degraded GitHub Pages + major Cloudflare surface in the mapped states', async () => {
    const { fetchVendorStatuses } = loadVendor({ fetch: stubFetch([
      ['githubstatus.com', { body: DEGRADED_GH_COMPONENTS }],
      ['cloudflarestatus.com', { body: MAJOR_CF_STATUS }],
    ]) });
    const [gh, cf] = await fetchVendorStatuses();
    expect(gh.status).toBe('degraded');
    expect(gh.raw_state).toBe('degraded_performance');
    expect(cf.status).toBe('down');
    expect(cf.raw_state).toBe('major');
    expect(cf.description).toBe('Cloudflare CDN degraded');
  });

  test('a failed feed produces an "unknown" card with an error string, no throw', async () => {
    const { fetchVendorStatuses } = loadVendor({ fetch: stubFetch([
      ['githubstatus.com', { ok: false, status: 503, body: {} }],
      ['cloudflarestatus.com', { body: OK_CF_STATUS }],
    ]) });
    const [gh, cf] = await fetchVendorStatuses();
    expect(gh.status).toBe('unknown');
    expect(gh.error).toMatch(/HTTP 503/);
    expect(cf.status).toBe('operational');
  });

  test('GitHub Pages component missing from the feed also degrades to "unknown"', async () => {
    const { fetchVendorStatuses } = loadVendor({ fetch: stubFetch([
      ['githubstatus.com', { body: { components: [{ id: 'other', name: 'Actions', status: 'operational' }] } }],
      ['cloudflarestatus.com', { body: OK_CF_STATUS }],
    ]) });
    const [gh] = await fetchVendorStatuses();
    expect(gh.status).toBe('unknown');
    expect(gh.error).toMatch(/component/i);
  });
});
