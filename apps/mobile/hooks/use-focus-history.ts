/**
 * Focus-history data hook (issue #96): every terminal focus session, newest
 * first, via the `packages/db` watched query.
 *
 * It is a WATCH query: the Focus screen writes the terminal transition while
 * this screen can be mounted behind it, and the watch re-fires the instant
 * the local transaction commits — no `reload()`-on-focus plumbing (contrast
 * hook-guidelines Rule 7, which is for query-style reads).
 *
 * The SDK's watch result has no `refresh` (`@powersync/react` 2.0.1 only
 * exposes it on the `runQueryOnce` path). Retrying a failed read therefore
 * remounts the screen component, which creates a fresh watch; see
 * `focus-history.tsx`.
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { focusHistoryWatchQuery, wrapDb, type FocusHistoryRow } from '@nextdo/db';

export interface UseFocusHistoryResult {
  data: FocusHistoryRow[];
  error: string | null;
  loading: boolean;
}

export function useFocusHistory(): UseFocusHistoryResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error, isLoading } = useQuery(focusHistoryWatchQuery(db));
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  return { data, error: error ? String(error.message) : null, loading: isLoading };
}
