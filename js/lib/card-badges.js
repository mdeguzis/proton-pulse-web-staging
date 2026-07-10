// Small opt-in badges rendered on browse-page game cards (#266 follow-up).
//
// Each badge is a small tile with white text on a faded Steam-blue background.
// Users pick which ones show on the Site Options page (pp:card-badges JSON);
// badges that need a signed-in Steam account are auto-hidden when the user
// isn't authenticated or hasn't synced yet.
//
// The default set:
//   - wishlist: "On wishlist" -- appId is in the user's Steam wishlist
//   - library:  "In library"  -- appId is in the user's Steam library
//
// Add new badges by:
//  1. Extending DEFAULTS + KNOWN_BADGES
//  2. Adding an entry to computeBadgesForAppId with the match condition
//  3. Wiring a checkbox in options.html (renderBadgePrefsMarkup below produces
//     the labels + input ids callers hook up).

const PREFS_KEY = 'pp:card-badges';

// Ordered so the badges render in the same order across the site.
export const KNOWN_BADGES = [
  { key: 'wishlist', label: 'On wishlist', requiresAuth: true,  color: '#66c0f4' },
  { key: 'library',  label: 'In library',  requiresAuth: true,  color: '#66c0f4' },
];

const DEFAULTS = { wishlist: true, library: true };

/**
 * Read the user's badge visibility prefs from localStorage. Every known
 * badge key gets a boolean; missing keys fall back to DEFAULTS[key]. Never
 * throws -- corrupt storage returns the defaults so the caller can render.
 */
export function getCardBadgePrefs() {
  let raw = null;
  try { raw = localStorage.getItem(PREFS_KEY); } catch { /* private mode */ }
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const out = {};
  for (const b of KNOWN_BADGES) {
    out[b.key] = parsed && typeof parsed[b.key] === 'boolean' ? parsed[b.key] : DEFAULTS[b.key];
  }
  return out;
}

/**
 * Merge a single toggle into the stored prefs (RMW). Idempotent -- the same
 * value in twice is a no-op.
 */
export function setCardBadgePref(key, on) {
  if (!KNOWN_BADGES.some((b) => b.key === key)) return;
  const cur = getCardBadgePrefs();
  cur[key] = !!on;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(cur)); } catch { /* ignore */ }
}

/**
 * Given an appId and a context bag ({libraryAppIds, wishlistAppIds, prefs,
 * signedIn}), return the badges that should appear on the card. Returns a
 * subset of KNOWN_BADGES so callers can style with the `color` field.
 *
 * ctx.prefs defaults to getCardBadgePrefs() when omitted.
 * ctx.signedIn defaults to true (badges gate on data being present anyway).
 */
export function computeBadgesForAppId(appId, ctx = {}) {
  const prefs = ctx.prefs || getCardBadgePrefs();
  const signedIn = ctx.signedIn !== false;
  const numericId = Number(appId);
  const results = [];
  for (const b of KNOWN_BADGES) {
    if (!prefs[b.key]) continue;
    if (b.requiresAuth && !signedIn) continue;
    let show = false;
    if (b.key === 'wishlist') {
      show = !!(ctx.wishlistAppIds && ctx.wishlistAppIds.has && ctx.wishlistAppIds.has(numericId));
    } else if (b.key === 'library') {
      show = !!(ctx.libraryAppIds && ctx.libraryAppIds.has && ctx.libraryAppIds.has(numericId));
    }
    if (show) results.push(b);
  }
  return results;
}

/**
 * Produce inline HTML for a badges row given a subset of KNOWN_BADGES.
 * Empty input yields empty string so callers can concat unconditionally.
 * Consumers must have escaped `label` at the KNOWN_BADGES source (they are
 * hardcoded here).
 */
export function renderBadgesHtml(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return '';
  const parts = badges.map((b) =>
    `<span class="game-card-mini-badge" data-badge="${b.key}" style="background:${b.color}">${b.label}</span>`,
  );
  return `<div class="game-card-mini-badges">${parts.join('')}</div>`;
}
