/**
 * The runtime-history modal still exists (aggregates community reports
 * by runtime type) but is no longer wired to the retired Native Linux
 * hint. Kept here as a source-shape regression guard on the aggregation
 * so a future refactor cannot silently break the report-timing view.
 *
 * The Native Linux hint under the artwork was removed as redundant with
 * the OS chip strip up top; the chips now carry the click affordance for
 * the Metadata modal.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'app', 'components', 'game-page.js'), 'utf8');

describe('runtime history modal (game-page)', () => {
  test('module still defines _openRuntimeHistoryModal even though the native hint is gone', () => {
    expect(SRC).toMatch(/function _openRuntimeHistoryModal\(appId, combined\)/);
  });

  test('OS chip strip is the click affordance for the Metadata modal (replaces the retired Native hint)', () => {
    // Each OS chip now opens the metadata modal; the old .game-native-linux
    // wiring was redundant with the availability chips.
    expect(SRC).not.toMatch(/nativeEl\.addEventListener\('click'/);
    expect(SRC).toMatch(/chip\.addEventListener\('click', \(\) => _openMetadataModal\(appId\)\)/);
  });

  test('aggregation buckets on r.runType and falls back to "unknown"', () => {
    expect(SRC).toContain("const key = r.runType || 'unknown';");
    expect(SRC).toContain('byRuntime.set(key, entry)');
  });

  test('tracks report count + first-seen (min ts) + last-updated (max)', () => {
    expect(SRC).toContain('entry.count++');
    expect(SRC).toMatch(/ts && ts < entry\.first/);
    expect(SRC).toMatch(/upd && upd > entry\.last/);
  });

  test('orders canonical runtimes first, unknown last', () => {
    expect(SRC).toContain("const CANONICAL_ORDER = ['native', 'proton', 'proton-experimental', 'proton-ge', 'proton-cachyos', 'proton-tkg', 'proton-lsfg'];");
    expect(SRC).toContain("if (a === 'unknown') return 1;");
    expect(SRC).toContain("if (b === 'unknown') return -1;");
  });

  test('empty state renders when no reports carry a runtime', () => {
    expect(SRC).toMatch(/No reports on this game carry a runtime yet/);
  });

  test('modal closes on Escape and on backdrop click', () => {
    expect(SRC).toContain("if (e.key === 'Escape')");
    expect(SRC).toMatch(/if \(e\.target === modal\) close\(\)/);
  });
});
