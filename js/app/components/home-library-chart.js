// Signed-in-only home page section: horizontal bar chart showing the rating
// breakdown across the user's cached Steam library (#199) or Steam wishlist
// (#266 refinement). Two chips ("Library" / "Wishlist") next to the title
// swap the source; only one is selected at a time.
import { getMyLibraryAppIds } from '../lib/user-library.js?v=1d8e72df';
import { getMyWishlistAppIds } from '../lib/user-wishlist.js?v=9c88bc65';
import { loadSearchIndex, searchIndex } from './search.js?v=598aaad1';
import { RATING_COLORS, RATING_TEXT } from '../config.js?v=f9591262';
import { esc } from '../utils.js?v=c7e1268c';

const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze', 'borked'];
const TIER_LABEL = {
  platinum: 'Platinum',
  gold:     'Gold',
  silver:   'Silver',
  bronze:   'Bronze',
  borked:   'Borked',
};

/**
 * Compute a tier -> count map for the intersection of appIds and search-index
 * entries. Exported so tests can pin down the aggregation logic without
 * touching the DOM.
 */
export function computeLibraryTierCounts(appIdSet, indexRows) {
  const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0, borked: 0, pending: 0, unrated: 0 };
  if (!appIdSet || appIdSet.size === 0 || !Array.isArray(indexRows)) return counts;
  for (const row of indexRows) {
    const appId = Number(row?.[0]);
    if (!Number.isFinite(appId) || !appIdSet.has(appId)) continue;
    const tier = String(row?.[2] || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, tier)) {
      counts[tier] += 1;
    } else if (tier === 'native') {
      counts.platinum += 1;
    } else {
      counts.unrated += 1;
    }
  }
  return counts;
}

// Copy per source so the subtitle stays natural for both modes.
const SOURCE_COPY = {
  library:  { title: 'Your library at a glance',  noun: 'owned',     empty: 'No Steam library synced yet.',  sync: 'library'  },
  wishlist: { title: 'Your wishlist at a glance', noun: 'wishlisted', empty: 'No Steam wishlist synced yet.', sync: 'wishlist' },
};

function _renderChartHtml(source, appIds, opts = {}) {
  const copy = SOURCE_COPY[source] || SOURCE_COPY.library;
  const chipsHtml = `
    <div class="hlc-chips" role="tablist" aria-label="Data source">
      <button type="button" class="hlc-chip${source === 'library'  ? ' hlc-chip--active' : ''}" data-source="library"  role="tab" aria-selected="${source === 'library'}">Library</button>
      <button type="button" class="hlc-chip${source === 'wishlist' ? ' hlc-chip--active' : ''}" data-source="wishlist" role="tab" aria-selected="${source === 'wishlist'}">Wishlist</button>
    </div>`;
  if (!appIds || appIds.size === 0) {
    return `
      <div class="home-library-chart home-library-chart--empty">
        <div class="hlc-header">
          <div class="hlc-title">${esc(copy.title)}</div>
          ${chipsHtml}
        </div>
        <div class="hlc-empty-body">
          ${esc(copy.empty)}
          <a href="profile.html">Sync your ${esc(copy.sync)}</a> to see a compatibility breakdown here.
        </div>
      </div>`;
  }
  const counts = computeLibraryTierCounts(appIds, searchIndex);
  const rated = TIER_ORDER.reduce((sum, t) => sum + (counts[t] || 0), 0);
  const total = appIds.size;
  const maxBar = Math.max(1, ...TIER_ORDER.map((t) => counts[t] || 0));
  const barsHtml = TIER_ORDER.map((tier) => {
    const n = counts[tier] || 0;
    const pct = Math.round((n / maxBar) * 100);
    const bg = RATING_COLORS[tier] || '#3a4a5a';
    const fg = RATING_TEXT[tier] || '#c8d4e0';
    return `
      <div class="hlc-row">
        <div class="hlc-label" style="color:${fg};background:${bg}">${esc(TIER_LABEL[tier])}</div>
        <div class="hlc-track"><div class="hlc-fill" style="width:${pct}%;background:${bg}"></div></div>
        <div class="hlc-count">${n.toLocaleString()}</div>
      </div>`;
  }).join('');
  return `
    <div class="home-library-chart">
      <div class="hlc-header">
        <div class="hlc-title">${esc(copy.title)}</div>
        ${chipsHtml}
      </div>
      <div class="hlc-subtitle">
        ${rated.toLocaleString()} of ${total.toLocaleString()} ${esc(copy.noun)} games have compatibility data.
      </div>
      <div class="hlc-bars">${barsHtml}</div>
    </div>`;
}

const HLC_SOURCE_KEY = 'pp:hlc-source';
function _readSource() {
  try {
    const v = localStorage.getItem(HLC_SOURCE_KEY);
    return v === 'wishlist' ? 'wishlist' : 'library';
  } catch { return 'library'; }
}
function _writeSource(v) {
  try { localStorage.setItem(HLC_SOURCE_KEY, v === 'wishlist' ? 'wishlist' : 'library'); } catch { /* ignore */ }
}

async function _fetchAppIds(source) {
  if (source === 'wishlist') return getMyWishlistAppIds().catch(() => new Set());
  return getMyLibraryAppIds().catch(() => new Set());
}

export async function renderHomeLibraryChart(mountEl) {
  if (!mountEl) return;
  const session = await window.SupaAuth?.getSession?.();
  if (!session?.user) {
    mountEl.innerHTML = '';
    return;
  }
  await loadSearchIndex().catch(() => null);
  let source = _readSource();
  let appIds = await _fetchAppIds(source);
  mountEl.innerHTML = _renderChartHtml(source, appIds);
  // Chip click swaps the source. State lives in localStorage so a reload
  // keeps whichever view the user prefers.
  mountEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.hlc-chip');
    if (!btn) return;
    const next = btn.dataset.source === 'wishlist' ? 'wishlist' : 'library';
    if (next === source) return;
    source = next;
    _writeSource(source);
    // Show a lightweight transitional state so the swap feels responsive
    // even if the wishlist Set has to lazy-sync on first click.
    const busy = mountEl.querySelector('.hlc-bars, .hlc-empty-body');
    if (busy) busy.style.opacity = '0.4';
    appIds = await _fetchAppIds(source);
    mountEl.innerHTML = _renderChartHtml(source, appIds);
  });
}
