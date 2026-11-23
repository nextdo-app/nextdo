/**
 * Direct-complete mutation hook (issue #106): the Inbox row's 「完成」 button
 * finishes a capture without walking the Clarify table. Delegates to the
 * packages/db `completeInboxItem` transaction — a `do_now` CompletionRecord
 * (no action entity is created) plus the soft-deleted InboxItem. A repeat
 * call for an already-completed capture (`inbox.not-found`) is benign: the
 * row is gone either way, so a double tap shows no error. `now` comes from
 * the single app clock (hook-guidelines Rule 4).
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { completeInboxItem, wrapDb } from '@nextdo/db';
import { NextdoError, logger } from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface UseCompleteInboxItemResult {
  complete: (id: string) => Promise<void>;
  error: string | null;
}

export function useCompleteInboxItem(): UseCompleteInboxItemResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(
    async (id: string) => {
      try {
        await completeInboxItem(db, { id, now });
        setError(null);
      } catch (err: unknown) {
        // A double tap (or another device completing the same capture) hits
        // `inbox.not-found` AFTER the first transaction already did exactly
        // what this tap asks for. The row is gone either way — not an error.
        if (err instanceof NextdoError && err.code === 'inbox.not-found') {
          setError(null);
          return;
        }
        logger.error('inbox complete failed', err instanceof Error ? err : new Error(String(err)));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [db, now],
  );

  return { complete, error };
}
