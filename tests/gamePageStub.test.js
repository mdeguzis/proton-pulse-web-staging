/**
 * Stub page for every known game (#363). Long-tail Steam titles (e.g. Cat Chess
 * / 4163030) live only in the extended index (search-index-steam-extended.json),
 * not the main search-index. The game-page stub must consult the extended index
 * when resolving a title, otherwise a known game with no reports falls through to
 * the generic "not in our mirror" state instead of a proper stub landing page.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'app', 'components', 'game-page.js'),
  'utf8',
);

describe('game-page stub resolves titles from the extended Steam index (#363)', () => {
  test('imports the extended index loader + array from search.js', () => {
    const imp = SRC.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/search\.js/);
    expect(imp).not.toBeNull();
    expect(imp[1]).toMatch(/loadExtendedSteamIndex/);
    expect(imp[1]).toMatch(/extendedSteamIndex/);
  });

  test('the stub branch falls back to the extended index when the title is unresolved', () => {
    // Isolate the stub branch (from the hard-miss guard to where it renders).
    const start = SRC.indexOf('if (!reports.length && !configs.length && !liveSummary)');
    const end = SRC.indexOf('if (stubTitle) {', start);
    const stubResolve = SRC.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // It loads the extended index and looks the appId up in it.
    expect(stubResolve).toMatch(/loadExtendedSteamIndex\(\)/);
    expect(stubResolve).toMatch(/extendedSteamIndex/);
    // And it still tries the cheaper sources first (main index, catalog).
    expect(stubResolve).toMatch(/loadSearchIndex\(\)/);
    expect(stubResolve).toMatch(/_fetchSteamCatalog\(\)/);
  });
});
