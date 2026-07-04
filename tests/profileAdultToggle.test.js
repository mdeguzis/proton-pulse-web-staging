/**
 * Source-shape pins for the Show Adult Games toggle on /profile.html
 * (added by #170 so signed-in users see the account-synced version of the
 * pref right in their account page, alongside username visibility).
 *
 * The full sync path is covered by tests/userPrefs.test.js. This file
 * just pins that the profile page has the toggle wired to the
 * user-prefs helpers -- otherwise a refactor could silently drop the
 * bidirectional sync (localStorage <-> Supabase) without any signal.
 */

const fs = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const HTML   = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
const MAIN   = fs.readFileSync(path.join(ROOT, 'js', 'profile', 'main.js'), 'utf8');

describe('profile page adult-games toggle wiring (#170)', () => {
  test('profile.html has the toggle input + status span', () => {
    expect(HTML).toContain('id="show-adult-toggle"');
    expect(HTML).toContain('id="show-adult-status"');
    // Should sit inside its own labelled field, next to the field-hint
    // that explains the cross-device sync.
    expect(HTML).toContain('Show adult games');
    expect(HTML).toMatch(/syncs across devices when you're signed in/i);
  });

  test('profile main.js imports the user-prefs helpers', () => {
    expect(MAIN).toMatch(/import\s*\{[^}]*setShowAdult[^}]*\}\s*from\s*'\.\.\/lib\/user-prefs\.js/);
    expect(MAIN).toMatch(/pullShowAdult/);
    expect(MAIN).toMatch(/readShowAdultLocal/);
  });

  test('profile main.js wires zero-flash init: local first, then server pull', () => {
    // Local read is synchronous so the toggle paints instantly; the
    // server pull runs after and updates the toggle if the value moved
    // on another device.
    expect(MAIN).toMatch(/adultToggle\.checked\s*=\s*localVal/);
    expect(MAIN).toMatch(/pullShowAdult\(\)\.then/);
  });

  test('change handler routes through setShowAdult and reflects sync state', () => {
    // setShowAdult writes localStorage first (immediate), then upserts
    // the Supabase row. The status text notes "device only" when the
    // server write failed / user is signed out.
    expect(MAIN).toMatch(/adultToggle\?\.addEventListener\('change'/);
    expect(MAIN).toMatch(/setShowAdult\(val\)\.then\(\(\{ synced \}\)/);
    expect(MAIN).toMatch(/device only/);
  });
});
