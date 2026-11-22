/**
 * Query tests — synced account settings (issue #97): the generic key → JSON
 * table written by the theme / focus / engine preference bridges.
 */
import {
  appSettingsQuery,
  getAppSetting,
  listAppSettings,
  setAppSetting,
  settingsRowId,
} from '../queries/settings';
import { settingsWatchQuery } from '../queries/watch-queries';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_NOW } from './fixtures';

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(): Promise<TestDb> {
  env = await openTestDb();
  return env;
}

const KEY = 'focus';

describe('settings queries', () => {
  it('returns no settings on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listAppSettings(db)).toEqual([]);
      expect(await getAppSetting(db, KEY)).toBeNull();
    } finally {
      await close();
    }
  });

  it('inserts one deterministic row per key and updates it in place', async () => {
    const { db, close } = await open();
    try {
      const first = await setAppSetting(db, { key: KEY, value: '{"lastMinutes":25}' }, FIXTURE_NOW);
      expect(first).toEqual({
        key: KEY,
        value: '{"lastMinutes":25}',
        updatedAt: FIXTURE_NOW.toISOString(),
      });

      const later = new Date(FIXTURE_NOW.getTime() + 60_000);
      await setAppSetting(db, { key: KEY, value: '{"lastMinutes":45}' }, later);

      const rows = await db.selectFrom('settings').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: settingsRowId(KEY),
        key: KEY,
        value: '{"lastMinutes":45}',
        updated_at: later.toISOString(),
      });
      expect(await getAppSetting(db, KEY)).toEqual({
        key: KEY,
        value: '{"lastMinutes":45}',
        updatedAt: later.toISOString(),
      });
    } finally {
      await close();
    }
  });

  it('onlyIfMissing never overwrites an existing live row', async () => {
    const { db, close } = await open();
    try {
      await setAppSetting(db, { key: KEY, value: 'synced' }, FIXTURE_NOW);
      const result = await setAppSetting(
        db,
        { key: KEY, value: 'local-old' },
        new Date(FIXTURE_NOW.getTime() + 60_000),
        { onlyIfMissing: true },
      );
      expect(result.value).toBe('synced');
      expect((await getAppSetting(db, KEY))?.value).toBe('synced');
    } finally {
      await close();
    }
  });

  it('excludes soft-deleted rows and revives one on a new write', async () => {
    const { db, close } = await open();
    try {
      await setAppSetting(db, { key: KEY, value: 'dark' }, FIXTURE_NOW);
      await db
        .updateTable('settings')
        .set({ deleted_at: FIXTURE_NOW.toISOString() })
        .where('id', '=', settingsRowId(KEY))
        .execute();
      expect(await listAppSettings(db)).toEqual([]);
      expect(await getAppSetting(db, KEY)).toBeNull();

      await setAppSetting(db, { key: KEY, value: 'light' }, FIXTURE_NOW);
      expect((await getAppSetting(db, KEY))?.value).toBe('light');
    } finally {
      await close();
    }
  });

  it('sorts by key and the watch query compiles and reads the same rows', async () => {
    const { db, close } = await open();
    try {
      await setAppSetting(db, { key: 'theme-preference', value: '"dark"' }, FIXTURE_NOW);
      await setAppSetting(db, { key: 'engine-context', value: '{"availableMinutes":90}' }, FIXTURE_NOW);
      await setAppSetting(db, { key: 'focus', value: '{"lastMinutes":25}' }, FIXTURE_NOW);

      expect((await appSettingsQuery(db).execute()).map((row) => row.key)).toEqual([
        'engine-context',
        'focus',
        'theme-preference',
      ]);

      const watch = settingsWatchQuery(db);
      expect(watch.compile().sql).toMatch(/from\s+"?settings"?/i);
      expect(await watch.execute()).toEqual(await listAppSettings(db));
    } finally {
      await close();
    }
  });

  it('rejects an empty key', async () => {
    const { db, close } = await open();
    try {
      await expect(setAppSetting(db, { key: '', value: 'x' }, FIXTURE_NOW)).rejects.toThrow(
        /settings key/i,
      );
    } finally {
      await close();
    }
  });
});
