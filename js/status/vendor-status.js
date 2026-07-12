// Vendor infrastructure health for status.html (#278).
//
// Reads the public Statuspage.io feeds for GitHub (Pages component) and
// Cloudflare (overall indicator) and returns cards shaped the same as the
// per-service Supabase edge function cards so renderService can consume them
// unchanged. Cloudflare's status page does not expose per-Workers granularity,
// so the overall Cloudflare indicator is the best proxy for a broader outage
// that would also drag down the pp-edge-status worker.

// Component id for GitHub Pages on githubstatus.com. Frozen upstream, safe to
// hardcode. Sibling ids exist for Actions, Packages, etc. if this list ever
// needs to grow.
export const GH_PAGES_COMPONENT_ID = 'vg70hn9s2tyj';
const GH_STATUS_COMPONENTS_URL = 'https://www.githubstatus.com/api/v2/components.json';
const CF_STATUS_URL = 'https://www.cloudflarestatus.com/api/v2/status.json';

// Same cadence as the announcements list -- 5 minutes is plenty for vendor
// status feeds that themselves update on the order of minutes, and it keeps
// the anonymous rate limit on githubstatus.com comfortably in the clear.
export const VENDOR_REFRESH_MS = 5 * 60 * 1000;

// Map a Statuspage.io component status string to the same operational /
// degraded / down / unknown vocabulary the Supabase cards already use.
export function componentStatusToState(s) {
  if (s === 'operational') return 'operational';
  if (s === 'degraded_performance' || s === 'partial_outage' || s === 'under_maintenance') return 'degraded';
  if (s === 'major_outage') return 'down';
  return 'unknown';
}

// Map a Statuspage.io overall indicator ("none" | "minor" | "major" |
// "critical" | "maintenance") to the same vocabulary. "none" == everything is
// green, not "unknown".
export function overallIndicatorToState(indicator) {
  if (indicator === 'none') return 'operational';
  if (indicator === 'minor' || indicator === 'maintenance') return 'degraded';
  if (indicator === 'major' || indicator === 'critical') return 'down';
  return 'unknown';
}

async function fetchGithubPages() {
  const start = Date.now();
  try {
    const res = await fetch(GH_STATUS_COMPONENTS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const components = Array.isArray(body?.components) ? body.components : [];
    const pages = components.find((c) => c.id === GH_PAGES_COMPONENT_ID);
    if (!pages) throw new Error('Pages component missing from feed');
    const state = componentStatusToState(pages.status);
    console.debug('[status] vendor GitHub Pages', { state, raw: pages.status, source: 'githubstatus.com/components.json', componentId: GH_PAGES_COMPONENT_ID });
    return {
      name: 'GitHub Pages',
      status: state,
      http_status: res.status,
      latency_ms: Date.now() - start,
      checked_at: new Date().toISOString(),
      vendor: 'github',
      vendor_status_url: 'https://www.githubstatus.com/',
      raw_state: pages.status,
      component_updated_at: pages.updated_at || null,
    };
  } catch (err) {
    console.warn('[status] vendor GitHub Pages fetch failed', { source: 'githubstatus.com/components.json', error: String(err && err.message || err) });
    return {
      name: 'GitHub Pages',
      status: 'unknown',
      http_status: 0,
      latency_ms: Date.now() - start,
      checked_at: new Date().toISOString(),
      vendor: 'github',
      vendor_status_url: 'https://www.githubstatus.com/',
      error: String(err && err.message || err),
    };
  }
}

async function fetchCloudflare() {
  const start = Date.now();
  try {
    const res = await fetch(CF_STATUS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const indicator = body?.status?.indicator || 'unknown';
    const description = body?.status?.description || '';
    const state = overallIndicatorToState(indicator);
    console.debug('[status] vendor Cloudflare', { state, indicator, description, source: 'cloudflarestatus.com/status.json' });
    return {
      name: 'Cloudflare (overall)',
      status: state,
      http_status: res.status,
      latency_ms: Date.now() - start,
      checked_at: new Date().toISOString(),
      vendor: 'cloudflare',
      vendor_status_url: 'https://www.cloudflarestatus.com/',
      raw_state: indicator,
      description,
    };
  } catch (err) {
    console.warn('[status] vendor Cloudflare fetch failed', { source: 'cloudflarestatus.com/status.json', error: String(err && err.message || err) });
    return {
      name: 'Cloudflare (overall)',
      status: 'unknown',
      http_status: 0,
      latency_ms: Date.now() - start,
      checked_at: new Date().toISOString(),
      vendor: 'cloudflare',
      vendor_status_url: 'https://www.cloudflarestatus.com/',
      error: String(err && err.message || err),
    };
  }
}

// Fetch both vendor feeds in parallel. Returns an array in a fixed display
// order (GitHub Pages first, then Cloudflare) so the DOM stays stable across
// refreshes.
export async function fetchVendorStatuses() {
  const [gh, cf] = await Promise.all([fetchGithubPages(), fetchCloudflare()]);
  return [gh, cf];
}
