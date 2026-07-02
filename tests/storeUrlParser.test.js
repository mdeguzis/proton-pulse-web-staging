/**
 * Tests for parseStoreUrl (#116).
 *
 * Covers each store's URL shapes, locale prefixes, trailing slashes,
 * query strings, and the no-match fallback (which the search box uses
 * to fall back to free-text search).
 */

const { parseStoreUrl } = require('../js/lib/store-url-parser.js');

describe('parseStoreUrl - Steam', () => {
  test('canonical /app/<id>/<slug>/ shape returns numeric appId', () => {
    expect(parseStoreUrl('https://store.steampowered.com/app/480490/Prey/'))
      .toEqual({ store: 'steam', appId: '480490', canonicalId: '480490', slug: null });
  });

  test('no trailing slug or slash still works', () => {
    expect(parseStoreUrl('https://store.steampowered.com/app/480490'))
      .toEqual({ store: 'steam', appId: '480490', canonicalId: '480490', slug: null });
  });

  test('query string on the end is ignored', () => {
    expect(parseStoreUrl('https://store.steampowered.com/app/480490/?utm_source=x'))
      .toEqual({ store: 'steam', appId: '480490', canonicalId: '480490', slug: null });
  });

  test('agecheck wrapper URL still yields the appId', () => {
    expect(parseStoreUrl('https://store.steampowered.com/agecheck/app/292030/'))
      .toEqual({ store: 'steam', appId: '292030', canonicalId: '292030', slug: null });
  });

  test('steamcommunity.com hub URLs also parse', () => {
    expect(parseStoreUrl('https://steamcommunity.com/app/480490'))
      .toEqual({ store: 'steam', appId: '480490', canonicalId: '480490', slug: null });
  });

  test('protocol-less input (host-only) still parses', () => {
    expect(parseStoreUrl('store.steampowered.com/app/480490'))
      .toEqual({ store: 'steam', appId: '480490', canonicalId: '480490', slug: null });
  });

  test('sub (package) URLs are not games -- returns null', () => {
    // We don't index packages; caller should fall back to text search.
    expect(parseStoreUrl('https://store.steampowered.com/sub/12345/')).toBeNull();
  });

  test('non-numeric appId slot bails out', () => {
    expect(parseStoreUrl('https://store.steampowered.com/app/notanumber')).toBeNull();
  });
});

describe('parseStoreUrl - GOG', () => {
  test('URL with locale prefix returns slug', () => {
    expect(parseStoreUrl('https://www.gog.com/en/game/star_wars_knights_of_the_old_republic'))
      .toEqual({ store: 'gog', appId: null, canonicalId: null, slug: 'star_wars_knights_of_the_old_republic' });
  });

  test('URL without locale prefix returns slug', () => {
    expect(parseStoreUrl('https://www.gog.com/game/witcher_3_wild_hunt'))
      .toEqual({ store: 'gog', appId: null, canonicalId: null, slug: 'witcher_3_wild_hunt' });
  });

  test('bare host without www still parses', () => {
    expect(parseStoreUrl('https://gog.com/en/game/star_wars_kotor'))
      .toEqual({ store: 'gog', appId: null, canonicalId: null, slug: 'star_wars_kotor' });
  });

  test('multi-part locale like pt-br works', () => {
    expect(parseStoreUrl('https://www.gog.com/pt-br/game/gwent'))
      .toEqual({ store: 'gog', appId: null, canonicalId: null, slug: 'gwent' });
  });

  test('non-game paths (movies, promos) return null', () => {
    expect(parseStoreUrl('https://www.gog.com/en/movie/some_movie')).toBeNull();
    expect(parseStoreUrl('https://www.gog.com/en/promo/summer_sale')).toBeNull();
  });

  test('trailing slash + query string ignored', () => {
    expect(parseStoreUrl('https://www.gog.com/en/game/witcher_3/?bg=1'))
      .toEqual({ store: 'gog', appId: null, canonicalId: null, slug: 'witcher_3' });
  });
});

describe('parseStoreUrl - Epic', () => {
  test('modern /p/<slug> with locale prefix', () => {
    expect(parseStoreUrl('https://store.epicgames.com/en-US/p/portal-2-cf80c3'))
      .toEqual({ store: 'epic', appId: null, canonicalId: null, slug: 'portal-2-cf80c3' });
  });

  test('modern /p/<slug> without locale', () => {
    expect(parseStoreUrl('https://store.epicgames.com/p/rocket-league'))
      .toEqual({ store: 'epic', appId: null, canonicalId: null, slug: 'rocket-league' });
  });

  test('legacy /product/<slug> path still parses', () => {
    expect(parseStoreUrl('https://store.epicgames.com/en-US/product/portal-2'))
      .toEqual({ store: 'epic', appId: null, canonicalId: null, slug: 'portal-2' });
  });

  test('epicgames.com (marketing site) also accepted', () => {
    expect(parseStoreUrl('https://www.epicgames.com/en-US/p/portal-2'))
      .toEqual({ store: 'epic', appId: null, canonicalId: null, slug: 'portal-2' });
  });

  test('non-store paths return null', () => {
    expect(parseStoreUrl('https://store.epicgames.com/en-US/news/some-article')).toBeNull();
  });
});

describe('parseStoreUrl - fallback / bad input', () => {
  test('empty / null / undefined returns null', () => {
    expect(parseStoreUrl('')).toBeNull();
    expect(parseStoreUrl(null)).toBeNull();
    expect(parseStoreUrl(undefined)).toBeNull();
  });

  test('free-text title search returns null (caller falls back)', () => {
    expect(parseStoreUrl('Portal 2')).toBeNull();
    expect(parseStoreUrl('star wars')).toBeNull();
  });

  test('numeric app id (not a URL) returns null so caller keeps its numeric path', () => {
    // The existing search dispatch treats a bare numeric input as an
    // appId directly; we don't want to interfere with that.
    expect(parseStoreUrl('480490')).toBeNull();
  });

  test('unknown host returns null', () => {
    expect(parseStoreUrl('https://example.com/app/480490')).toBeNull();
  });

  test('garbage URL string returns null instead of throwing', () => {
    expect(parseStoreUrl('http://')).toBeNull();
    expect(parseStoreUrl('://not a url')).toBeNull();
  });
});
