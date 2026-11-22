/**
 * Trash / recycle-bin data hook (issue #89): every soft-deleted user-facing
 * row via `trashedItemsWatchQuery`, plus the restore mutation.
 *
 * A WATCH query, not a read-on-mount one: restoring clears `deleted_at` in
 * the row's own table, so the watch drops the row the instant the write
 * commits — no `reload()` plumbing.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import {
  restoreTrashedItem,
  trashedItemsWatchQuery,
  wrapDb,
  type TrashKind,
  type TrashedItem,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseTrashedItemsResult {
  /** Newest delete first. */
  data: TrashedItem[];
  /** The watch's raw error (kept as an Error so `errorMessage` can map its
   *  NextdoError code). */
  error: unknown;
  isLoading: boolean;
  /** `${kind}:${id}` keys whose restore is in flight — the screen disables
   *  that row's button. The DB transaction is the real double-restore guard. */
  restoring: ReadonlySet<string>;
  restore: (args: { kind: TrashKind; id: string }) => Promise<boolean>;
  /** The last restore's raw error (same NextdoError-preserving rule). */
  mutationError: unknown;
}

export function trashKey(kind: TrashKind, id: string): string {
  return `${kind}:${id}`;
}

export function useTrashedItems(): UseTrashedItemsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error, isLoading } = useQuery(trashedItemsWatchQuery(db));
  const now = useAppClock();
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(() => new Set());

  const restore = useCallback(
    async (args: { kind: TrashKind; id: string }): Promise<boolean> => {
      const key = trashKey(args.kind, args.id);
      setMutationError(null);
      setRestoring((prev) => new Set(prev).add(key));
      try {
        await restoreTrashedItem(db, { ...args, now });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('failed to restore trashed item', err instanceof Error ? err : new Error(message));
        setMutationError(err);
        return false;
      } finally {
        setRestoring((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [db, now],
  );

  return {
    data: data ?? [],
    error: error ?? null,
    isLoading,
    restoring,
    restore,
    mutationError,
  };
}
