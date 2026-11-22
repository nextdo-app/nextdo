/**
 * Account-level settings that sync across devices (issue #97).
 *
 * The `settings` table is a generic key → JSON-value store. Only the keys
 * listed in the app's synced-settings bridge use it; device-local
 * preferences (notifications, habit reminders, update channel, calendar
 * target) stay in their own platform stores.
 *
 * Row identity is DETERMINISTIC: `id = "setting:<key>"`. Two devices that
 * write the same key therefore address the same row, so PowerSync's
 * row-level upsert / last-write-wins merges them instead of leaving two
 * rows for one key. This is the one table whose ids are not ULIDs.
 *
 * All writes go through the local SQLite first (local-first): the row is
 * durable and readable offline, and PowerSync uploads it when connected.
 */
import { StorageNextdoError, toIso } from '@nextdo/core';
import type { NextdoDb } from '../types';

export const SETTINGS_ROW_ID_PREFIX = 'setting:';

/** The row id for a settings key — stable across devices. */
export function settingsRowId(key: string): string {
  return `${SETTINGS_ROW_ID_PREFIX}${key}`;
}

export interface AppSetting {
  key: string;
  /** JSON text — the writer and reader agree on the per-key shape. */
  value: string;
  updatedAt: string;
}

export interface SetAppSettingOptions {
  /**
   * Seed-only write: when a live row already exists, leave it untouched and
   * return it. Used by the first-login migration so a device's old local
   * value cannot overwrite a row already downloaded from another device.
   */
  onlyIfMissing?: boolean;
}

/** Row → app shape (shared by the plain list and the watch query). */
export function appSettingFromRow(row: {
  key: string | null;
  value: string | null;
  updated_at: string | null;
}): AppSetting {
  return {
    key: row.key ?? '',
    value: row.value ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

/** The plain (non-reactive) read of all live settings, ordered by key. */
export function appSettingsQuery(db: NextdoDb) {
  return db
    .selectFrom('settings')
    .select(['key', 'value', 'updated_at'])
    .where('deleted_at', 'is', null)
    .orderBy('key');
}

export async function listAppSettings(db: NextdoDb): Promise<AppSetting[]> {
  const rows = await appSettingsQuery(db).execute();
  return rows.map(appSettingFromRow);
}

export async function getAppSetting(db: NextdoDb, key: string): Promise<AppSetting | null> {
  const row = await db
    .selectFrom('settings')
    .select(['key', 'value', 'updated_at'])
    .where('deleted_at', 'is', null)
    .where('key', '=', key)
    .executeTakeFirst();
  return row === undefined ? null : appSettingFromRow(row);
}

/**
 * Upsert one setting. The first write inserts the deterministic-id row;
 * later writes update its value and `updated_at`. A soft-deleted row is
 * revived on write (a user who changes the setting again means it is live).
 */
export async function setAppSetting(
  db: NextdoDb,
  args: { key: string; value: string },
  now: Date,
  options?: SetAppSettingOptions,
): Promise<AppSetting> {
  if (typeof args.key !== 'string' || args.key === '') {
    throw new StorageNextdoError('setting.invalid-key', 'A settings key must be a non-empty string');
  }
  if (typeof args.value !== 'string') {
    throw new StorageNextdoError('setting.invalid-value', 'A settings value must be a string');
  }
  const id = settingsRowId(args.key);
  const existing = await db
    .selectFrom('settings')
    .select(['key', 'value', 'updated_at', 'deleted_at'])
    .where('id', '=', id)
    .executeTakeFirst();
  const nowIso = toIso(now);
  if (existing === undefined) {
    await db
      .insertInto('settings')
      .values({
        id,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        key: args.key,
        value: args.value,
      })
      .execute();
    return { key: args.key, value: args.value, updatedAt: nowIso };
  }
  if (options?.onlyIfMissing === true && existing.deleted_at === null) {
    return appSettingFromRow(existing);
  }
  await db
    .updateTable('settings')
    .set({ value: args.value, updated_at: nowIso, deleted_at: null })
    .where('id', '=', id)
    .execute();
  return { key: args.key, value: args.value, updatedAt: nowIso };
}
