/**
 * Contexts data hook (Now screen's scene chips, design.md §4.1): the
 * non-deleted contexts + inline quick-create (`addContext`) and the soft
 * delete (`remove` → `trashContext`).
 *
 * Query-style by design (design.md §5 — no contexts watch query in the
 * frozen packages/db surface; personal-scale data, re-read on mount and
 * after each mutation). Both mutations re-read by bumping `reloadKey`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { addContext, listContexts, trashContext, wrapDb } from '@nextdo/db';
import { logger, toIso, ulid, type Context } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseContextsResult {
  /** null until the first read settles. */
  data: Context[] | null;
  error: string | null;
  /** Quick-create a context (returns the created context id, or null on empty/error). */
  add: (name: string) => Promise<string | null>;
  /**
   * Soft delete a context (the contexts screen's per-row 删除).
   * Resolves true when the local write committed; false on error (the
   * typed `error` is set either way) — callers re-read on `true` only
   * (hook-guidelines Rule 9: gate the reload on the boolean).
   */
  remove: (id: string) => Promise<boolean>;
  /**
   * Re-read on demand (hook-guidelines Rule 7). Needed because the
   * `/contexts` screen writes the SAME rows this hook reads: the Now
   * screen's bar stays MOUNTED while `/contexts` is pushed on top, so a
   * scene deleted there never reaches an already-mounted chip list.
   * The Now screen calls this from `useFocusEffect`.
   */
  reload: () => void;
}

let cachedContexts: Context[] | null = null;

/** Test hook: reset module cache between test runs. */
export function __clearContextsCacheForTests(): void {
  cachedContexts = null;
}

export function useContexts(): UseContextsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [data, setData] = useState<Context[] | null>(() => cachedContexts);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listContexts(db)
      .then((contexts) => {
        if (!cancelled) {
          cachedContexts = contexts;
          setData(contexts);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('contexts query failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, reloadKey]);

  const add = useCallback(
    async (name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (trimmed === '') return null;
      const nowIso = toIso(now);
      const context: Context = {
        id: ulid(now),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        name: trimmed,
      };
      try {
        await addContext(db, context);
        setError(null);
        setReloadKey((key) => key + 1);
        return context.id;
      } catch (err: unknown) {
        logger.error('context create failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [db, now],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await trashContext(db, { id, now });
        setError(null);
        setReloadKey((key) => key + 1);
        return true;
      } catch (err: unknown) {
        logger.error('context trash failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [db, now],
  );

  return { data, error, add, remove, reload };
}
