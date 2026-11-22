/**
 * Synced-settings bridge (issue #97): mounts inside the PowerSync provider,
 * watches the `settings` table and keeps the device-local theme / focus /
 * engine modules in step with the account.
 *
 * Two directions:
 *  - downloaded rows → `applySyncedSetting` applies them to the modules
 *    (which notify their subscribers and refresh the local first-paint cache);
 *  - user writes → the modules report the value through
 *    `synced-settings-bus`, and the writer registered here persists it to the
 *    local PowerSync DB (uploaded when connected).
 *
 * A key with no row yet is seeded from the device's EXPLICIT local value,
 * once, with `onlyIfMissing` — a fresh device must not overwrite another
 * device's choice with a default, and an already-downloaded row wins.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { logger } from '@nextdo/core';
import { setAppSetting, settingsWatchQuery, wrapDb } from '@nextdo/db';
import {
  hasPendingSyncedSetting,
  registerSyncedSettingWriter,
  restorePendingSyncedSettings,
} from '@/lib/synced-settings-bus';
import {
  applySyncedSetting,
  readLocalSettingForSync,
  SYNCED_SETTING_KEYS,
} from '@/lib/synced-settings';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useSyncedSettings(): void {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, isLoading, error } = useQuery(settingsWatchQuery(db));
  const seededKeys = useRef(new Set<string>());
  const reportedError = useRef<string | null>(null);
  const [pendingReady, setPendingReady] = useState(false);

  // Restore uncommitted writes saved before a reload/restart BEFORE applying
  // any downloaded row: the local intent outranks the older row.
  useEffect(() => {
    let cancelled = false;
    void restorePendingSyncedSettings().finally(() => {
      if (!cancelled) setPendingReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // User writes: persist the same JSON the local cache holds. The writer
  // rejects on a DB failure; the bus keeps the intent pending and the retry
  // banner surfaces it. Do NOT swallow it here — a silent failure would let
  // a later stale watch emission overwrite the user's choice.
  useEffect(() => {
    registerSyncedSettingWriter(async (key, value) => {
      await setAppSetting(db, { key, value }, new Date());
    });
    return () => {
      registerSyncedSettingWriter(null);
    };
  }, [db]);

  // Downloaded rows → modules; missing rows → one-time seed from the local
  // explicitly-stored value. Wait for the pending-write restore so a reload
  // cannot apply an old row before the uncommitted intent is known. The watch
  // re-fires after a seed; applying the same value again is idempotent.
  useEffect(() => {
    if (!pendingReady) return;
    if (error) {
      const message = toError(error).message;
      if (message !== reportedError.current) {
        reportedError.current = message;
        logger.warn('synced settings read failed', toError(error));
      }
      return;
    }
    if (isLoading) return;
    const rowsByKey = new Map(data.map((row) => [row.key, row]));
    for (const key of SYNCED_SETTING_KEYS) {
      const row = rowsByKey.get(key);
      if (row !== undefined) {
        // The newest local value has not reached the table yet (in flight or
        // failed): this row is stale for that key. Applying it would undo a
        // user choice that the retry banner is still offering to save.
        if (hasPendingSyncedSetting(key)) continue;
        if (!applySyncedSetting(key, row.value)) {
          logger.warn('synced settings: ignored invalid value', new Error(`key=${key}`));
        }
        continue;
      }
      if (seededKeys.current.has(key) || hasPendingSyncedSetting(key)) continue;
      seededKeys.current.add(key);
      void readLocalSettingForSync(key).then((value) => {
        if (value === null) return;
        return setAppSetting(db, { key, value }, new Date(), { onlyIfMissing: true }).catch(
          (caught: unknown) => {
            logger.warn('synced settings seed failed', toError(caught));
          },
        );
      });
    }
  }, [data, isLoading, error, db, pendingReady]);
}
