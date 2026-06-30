/**
 * Tests for the pending review detail page wrapping long opaque IDs
 * (md5 approval hash, UUIDs) instead of forcing horizontal scroll.
 *
 * Source-shape only -- pending.js renders into a real DOM and pulls Supabase
 * state, so the full behavior needs jsdom + supabase mocks. The wrap intent
 * is small enough that pinning the field list + render branch is enough to
 * catch regressions.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'admin', 'components', 'pending.js'),
  'utf8'
);

describe('pending review detail: long-ID wrap (#141 verification UX)', () => {
  test('Approval Hash field carries wrap:true so it breaks across lines', () => {
    expect(SRC).toMatch(/\['Approval Hash',\s*val\(report\._approval_hash\),\s*\{\s*wrap:\s*true\s*\}\]/);
  });

  test('Author and Client ID fields also wrap (long UUIDs)', () => {
    expect(SRC).toContain("['Author', report.proton_pulse_user_id || report.client_id || 'anonymous', { wrap: true }]");
    expect(SRC).toContain("['Client ID', val(report.client_id), { wrap: true }]");
  });

  test('non-wrap fields stay 2-tuples (regression guard)', () => {
    // App ID, Title, OS, etc. should NOT carry wrap because they are short
    // and look weird if forced to break-all.
    expect(SRC).toMatch(/\['App ID', val\(report\.app_id\)\],/);
    expect(SRC).toMatch(/\['Title', val\(report\.title\)\],/);
    expect(SRC).toMatch(/\['Rating', val\(report\.rating\)\],/);
  });

  test('renderer applies word-break:break-all only when opts.wrap is set', () => {
    expect(SRC).toContain("opts && opts.wrap");
    expect(SRC).toContain('word-break:break-all');
    expect(SRC).toContain('white-space:normal');
  });

  test('renderer uses monospace font for wrapped cells', () => {
    // Long hex hashes read much cleaner in mono; also visually distinguishes
    // them from prose values like Notes.
    expect(SRC).toContain('font-family:var(--mono)');
  });
});
