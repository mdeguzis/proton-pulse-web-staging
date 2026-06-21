const fs = require('fs');
const path = require('path');

const backupSrc = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'scripts', 'backup.mjs'),
  'utf8'
);

// Tables that the backup script fetches. Each must either have an `id` column
// or an explicit entry in TABLE_ORDER_KEY. Adding a new table without one is
// the bug that caused the June 2026 nightly backup failure.
const FETCHED_TABLES = [
  'user_configs',
  'author_avatars',
  'user_proton_configs',
  'user_systems',
  'admins',
  'banned_users',
];

// Tables confirmed to lack an `id` column (use a named PK instead).
const NO_ID_TABLES = ['author_avatars'];

describe('backup script order key safety', () => {
  test('TABLE_ORDER_KEY covers every table that lacks an id column', () => {
    for (const table of NO_ID_TABLES) {
      expect(backupSrc).toContain(`${table}:`);
    }
  });

  test('fetchAll URL uses the table-specific order key, not always id', () => {
    expect(backupSrc).toContain('TABLE_ORDER_KEY[table]');
    expect(backupSrc).toContain("|| 'id'");
    expect(backupSrc).toContain('order=${orderKey}.asc');
  });

  test('author_avatars backup selects only safe non-PII columns', () => {
    expect(backupSrc).toContain("'author_avatars', 'proton_pulse_user_id,display_name,avatar_url,cached_at'");
  });

  test('all expected tables are present in the schema export list', () => {
    for (const table of FETCHED_TABLES) {
      expect(backupSrc).toContain(`'${table}'`);
    }
  });
});
