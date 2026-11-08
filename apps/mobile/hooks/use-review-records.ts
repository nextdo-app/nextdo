/**
 * Review data hook: the append-only review record trail (oldest first) via
 * the `packages/db` watched query. The Review tab lists these; the daily and
 * weekly review flows write to the same trail.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { reviewRecordsWatchQuery, wrapDb } from '@nextdo/db';
import { logger, type ReviewRecord } from '@nextdo/core';

export interface UseReviewRecordsResult {
  data: ReviewRecord[];
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useReviewRecords(): UseReviewRecordsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { data, error, isLoading, refresh } = useQuery(reviewRecordsWatchQuery(db));
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  const reload = useCallback(() => {
    void refresh?.().then(() => setRefreshError(null)).catch((err: unknown) => {
      logger.error('review history refresh failed', err instanceof Error ? err : new Error(String(err)));
      setRefreshError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh]);
  return { data, error: error ? String(error.message) : refreshError, loading: isLoading, reload };
}
