/**
 * Card mini-badges tests (#266 follow-up).
 *
 * Covers:
 *  1. js/lib/card-badges.js: prefs storage, badge computation, HTML render.
 *  2. renderGameCard integration: miniBadges HTML lands under the title
 *     and the report-count sub line is omitted when sub is empty.
 *  3. home.js source uses the new context helper + drops the sub.
 *  4. options.html + main.js wire the checkbox group and reset key.
 */
const fs = require('fs');
const path = require('path');
const { loadEsm } = require('./_esm-vm.js');

// ---------- Part 1: card-badges.js ---------------------------------------

function loadCardBadges() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  const ctx = loadEsm(['js/lib/card-badges.js'], { localStorage, console: { debug: () => {} } });
  return { ...ctx, _store: store };
}

describe('card-badges.js: prefs storage', () => {
  test('defaults: wishlist + library are on when no localStorage entry exists', () => {
    const { getCardBadgePrefs } = loadCardBadges();
    const p = getCardBadgePrefs();
    expect(p.wishlist).toBe(true);
    expect(p.library).toBe(true);
  });

  test('setCardBadgePref roundtrips a single toggle without clobbering others', () => {
    const { setCardBadgePref, getCardBadgePrefs } = loadCardBadges();
    setCardBadgePref('wishlist', false);
    let p = getCardBadgePrefs();
    expect(p.wishlist).toBe(false);
    expect(p.library).toBe(true); // untouched
    setCardBadgePref('library', false);
    p = getCardBadgePrefs();
    expect(p.wishlist).toBe(false);
    expect(p.library).toBe(false);
  });

  test('setCardBadgePref ignores unknown badge keys', () => {
    const { setCardBadgePref, _store } = loadCardBadges();
    setCardBadgePref('nonsense', true);
    expect(_store['pp:card-badges']).toBeUndefined();
  });

  test('corrupt storage still yields defaults', () => {
    const { getCardBadgePrefs, _store } = loadCardBadges();
    _store['pp:card-badges'] = '{{not json';
    const p = getCardBadgePrefs();
    expect(p.wishlist).toBe(true);
    expect(p.library).toBe(true);
  });
});

describe('card-badges.js: computeBadgesForAppId', () => {
  test('returns wishlist badge when appId is in wishlist Set + pref is on', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(570, {
      prefs: { wishlist: true, library: true },
      wishlistAppIds: new Set([570]),
      libraryAppIds: new Set(),
      signedIn: true,
    });
    expect(badges.map((b) => b.key)).toEqual(['wishlist']);
    expect(badges[0].label).toBe('On wishlist');
  });

  test('returns library badge when appId is in library Set', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(440, {
      prefs: { wishlist: true, library: true },
      wishlistAppIds: new Set(),
      libraryAppIds: new Set([440]),
      signedIn: true,
    });
    expect(badges.map((b) => b.key)).toEqual(['library']);
  });

  test('returns both when the appId is in both Sets (edge case, e.g. dev testing)', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(730, {
      prefs: { wishlist: true, library: true },
      wishlistAppIds: new Set([730]),
      libraryAppIds: new Set([730]),
      signedIn: true,
    });
    expect(badges.map((b) => b.key).sort()).toEqual(['library', 'wishlist']);
  });

  test('signed-out hides auth-gated badges even when the Sets contain the id', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(570, {
      prefs: { wishlist: true, library: true },
      wishlistAppIds: new Set([570]),
      libraryAppIds: new Set([570]),
      signedIn: false,
    });
    expect(badges).toEqual([]);
  });

  test('turned-off pref suppresses that badge', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(570, {
      prefs: { wishlist: false, library: true },
      wishlistAppIds: new Set([570]),
      libraryAppIds: new Set([570]),
      signedIn: true,
    });
    expect(badges.map((b) => b.key)).toEqual(['library']);
  });

  test('appId not in any Set returns empty array', () => {
    const { computeBadgesForAppId } = loadCardBadges();
    const badges = computeBadgesForAppId(999999, {
      prefs: { wishlist: true, library: true },
      wishlistAppIds: new Set([1, 2, 3]),
      libraryAppIds: new Set([10, 20]),
      signedIn: true,
    });
    expect(badges).toEqual([]);
  });
});

describe('card-badges.js: renderBadgesHtml', () => {
  test('renders one tile per badge with the Steam-blue color and label', () => {
    const { KNOWN_BADGES, renderBadgesHtml } = loadCardBadges();
    const wishlist = KNOWN_BADGES.find((b) => b.key === 'wishlist');
    const html = renderBadgesHtml([wishlist]);
    expect(html).toContain('class="game-card-mini-badges"');
    expect(html).toContain('data-badge="wishlist"');
    expect(html).toContain('background:#66c0f4');
    expect(html).toContain('On wishlist');
  });

  test('empty input yields empty string so callers can concat safely', () => {
    const { renderBadgesHtml } = loadCardBadges();
    expect(renderBadgesHtml([])).toBe('');
    expect(renderBadgesHtml(undefined)).toBe('');
  });
});


// ---------- Part 2: renderGameCard integration --------------------------

const CARD_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'app', 'lib', 'card.js'),
  'utf8',
);

describe('renderGameCard: miniBadges + optional sub', () => {
  test('accepts a miniBadges opt in the destructured signature', () => {
    expect(CARD_SRC).toMatch(/renderGameCard\(\{[^}]*miniBadges[^}]*\}\)/);
  });

  test('sub is only rendered when non-empty (empty string = no sub line)', () => {
    expect(CARD_SRC).toContain('const subHtml = sub ?');
    expect(CARD_SRC).toContain('${subHtml}${miniBadgesHtml}');
  });
});


// ---------- Part 3: home.js source --------------------------------------

const HOME_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'app', 'components', 'home.js'),
  'utf8',
);

describe('home.js: uses badges + drops the report-count sub', () => {
  test('imports the card-badges helpers', () => {
    expect(HOME_SRC).toMatch(/from '\.\.\/\.\.\/lib\/card-badges\.js/);
    expect(HOME_SRC).toContain('computeBadgesForAppId');
    expect(HOME_SRC).toContain('renderBadgesHtml');
  });

  test('_recentCardHtml passes empty sub and computed miniBadges', () => {
    expect(HOME_SRC).toMatch(/function _recentCardHtml[\s\S]{0,800}sub: ''/);
    expect(HOME_SRC).toMatch(/function _recentCardHtml[\s\S]{0,800}miniBadges: _badgesFor\(r\.appId\)/);
  });

  test('_popularItemHtml passes empty sub and computed miniBadges', () => {
    expect(HOME_SRC).toMatch(/function _popularItemHtml[\s\S]{0,900}sub: ''/);
    expect(HOME_SRC).toMatch(/function _popularItemHtml[\s\S]{0,900}miniBadges: _badgesFor\(g\.appId\)/);
  });

  test('renderHomePage populates the badge context before rendering', () => {
    expect(HOME_SRC).toContain('_cardBadgeCtx = await _buildCardBadgeContext()');
    expect(HOME_SRC).toContain('function _buildCardBadgeContext()');
  });
});


// ---------- Part 4: options.html + options/main.js -----------------------

const OPTIONS_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'options.html'),
  'utf8',
);
const OPTIONS_MAIN = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'options', 'main.js'),
  'utf8',
);

describe('options.html + options/main.js wiring', () => {
  test('markup has the new checkbox group with wishlist + library entries', () => {
    expect(OPTIONS_HTML).toContain('id="opt-card-badges"');
    expect(OPTIONS_HTML).toContain('data-badge-key="wishlist"');
    expect(OPTIONS_HTML).toContain('data-badge-key="library"');
    expect(OPTIONS_HTML).toContain('On wishlist');
    expect(OPTIONS_HTML).toContain('In library');
  });

  test('main.js hydrates checkboxes from getCardBadgePrefs and writes on change', () => {
    expect(OPTIONS_MAIN).toMatch(/from '\.\.\/lib\/card-badges\.js/);
    expect(OPTIONS_MAIN).toContain('getCardBadgePrefs()');
    expect(OPTIONS_MAIN).toContain('setCardBadgePref(key, cb.checked)');
  });

  test('reset button clears pp:card-badges alongside the other keys', () => {
    expect(OPTIONS_MAIN).toContain('CARD_BADGES_KEY');
    expect(OPTIONS_MAIN).toContain("const CARD_BADGES_KEY = 'pp:card-badges'");
    expect(OPTIONS_MAIN).toMatch(/RESET_KEYS\s*=\s*\[[^\]]*CARD_BADGES_KEY/);
  });
});
