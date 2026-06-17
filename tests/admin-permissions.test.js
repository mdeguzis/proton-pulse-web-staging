/**
 * Tests for js/admin/permissions.js -- the pure capability model that mirrors
 * the RLS helper current_user_has_permission(). babel-jest transforms the ES
 * module so Jest can require() it.
 */
const P = require('../js/admin/permissions.js');

const ALL_TABS = ['users', 'flagged', 'banned', 'admins', 'phrases', 'analytics'];

describe('effectivePermissions', () => {
  test('super_admin gets all permissions regardless of stored array', () => {
    expect(P.effectivePermissions('super_admin', []).sort())
      .toEqual(P.ALL_PERMISSION_KEYS.slice().sort());
  });
  test('moderator gets its stored permissions', () => {
    expect(P.effectivePermissions('moderator', ['ban_users'])).toEqual(['ban_users']);
  });
  test('missing/invalid permissions resolve to empty', () => {
    expect(P.effectivePermissions('custom')).toEqual([]);
    expect(P.effectivePermissions('custom', null)).toEqual([]);
  });
});

describe('hasPermission', () => {
  test('super_admin has every permission even with an empty array', () => {
    for (const k of P.ALL_PERMISSION_KEYS) {
      expect(P.hasPermission('super_admin', [], k)).toBe(true);
    }
  });
  test('moderator preset grants reports/ban/analytics, not phrases/admins', () => {
    const perms = P.ROLE_PRESETS.moderator;
    expect(P.hasPermission('moderator', perms, 'manage_reports')).toBe(true);
    expect(P.hasPermission('moderator', perms, 'delete_reports')).toBe(true);
    expect(P.hasPermission('moderator', perms, 'ban_users')).toBe(true);
    expect(P.hasPermission('moderator', perms, 'view_analytics')).toBe(true);
    expect(P.hasPermission('moderator', perms, 'manage_phrases')).toBe(false);
    expect(P.hasPermission('moderator', perms, 'manage_admins')).toBe(false);
  });
  test('no permissions grants nothing', () => {
    expect(P.hasPermission('custom', [], 'manage_reports')).toBe(false);
  });
});

describe('canSeeTab / visibleTabs', () => {
  test('Users tab is visible to any admin', () => {
    expect(P.canSeeTab('custom', [], 'users')).toBe(true);
  });
  test('moderator sees content tabs but not admins/phrases', () => {
    expect(P.visibleTabs('moderator', P.ROLE_PRESETS.moderator, ALL_TABS).sort())
      .toEqual(['analytics', 'banned', 'flagged', 'users'].sort());
  });
  test('super_admin sees every tab', () => {
    expect(P.visibleTabs('super_admin', [], ALL_TABS).sort())
      .toEqual(ALL_TABS.slice().sort());
  });
  test('a phrases-only custom admin sees just phrases + users', () => {
    expect(P.visibleTabs('custom', ['manage_phrases'], ALL_TABS).sort())
      .toEqual(['phrases', 'users'].sort());
  });
  test('flagged tab needs manage_reports OR delete_reports', () => {
    expect(P.canSeeTab('custom', ['delete_reports'], 'flagged')).toBe(true);
    expect(P.canSeeTab('custom', ['manage_reports'], 'flagged')).toBe(true);
    expect(P.canSeeTab('custom', ['ban_users'], 'flagged')).toBe(false);
  });
});

describe('resolveRoleLabel', () => {
  test('super_admin label', () => {
    expect(P.resolveRoleLabel('super_admin', [])).toBe('super_admin');
  });
  test('exact moderator preset resolves to moderator', () => {
    expect(P.resolveRoleLabel('moderator', P.ROLE_PRESETS.moderator)).toBe('moderator');
  });
  test('preset match is order-insensitive', () => {
    expect(P.resolveRoleLabel('moderator', P.ROLE_PRESETS.moderator.slice().reverse()))
      .toBe('moderator');
  });
  test('a divergent permission set is custom', () => {
    expect(P.resolveRoleLabel('moderator', ['ban_users'])).toBe('custom');
    expect(P.resolveRoleLabel('custom', ['manage_reports', 'manage_admins'])).toBe('custom');
  });
});

describe('shape sanity', () => {
  test('every permission has a label', () => {
    for (const k of P.ALL_PERMISSION_KEYS) {
      expect(typeof P.PERMISSION_LABELS[k]).toBe('string');
      expect(P.PERMISSION_LABELS[k].length).toBeGreaterThan(0);
    }
  });
  test('moderator preset is a subset of all permissions', () => {
    for (const k of P.ROLE_PRESETS.moderator) {
      expect(P.ALL_PERMISSION_KEYS).toContain(k);
    }
  });
});
