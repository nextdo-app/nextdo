/**
 * Completed-actions read hook (issue 27): the live list behind the
 * 「已完成行动」 window — every done NextAction / CalendarAction with the
 * instant of its latest completion.
 *
 * It is a WATCH query, not a read-on-mount one, because the only thing that
 * changes this list is a local mutation on another screen (the restore in the
 * window itself, or a completion made from the Now screen) — the watch
 * re-fires the instant the restore transaction commits, so no `reload()`
 * plumbing is needed (contrast hook-guidelines Rule 7).
 */
import { useMemo } from 'react';
import { usePowerSync, useQuery } from '@powersync/react';
import { completedActionsWatchQuery, wrapDb, type CompletedAction } from '@nextdo/db';

export interface UseCompletedActionsResult {
  /** Newest completion first. */
  data: CompletedAction[];
  error: string | null;
}

export function useCompletedActions(): UseCompletedActionsResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const { data, error } = useQuery(completedActionsWatchQuery(db));
  // The watch statement is a UNION of the two action tables, so SQL hands
  // them back in whatever order the planner likes; the window always shows
  // the most recent completion on top, same order `listCompletedActions`
  // (the non-reactive twin) produces.
  const rows = useMemo(
    () =>
      [...data].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [data],
  );
  // `@powersync/react` types `error` as `Error | undefined` but delivers
  // `null` at runtime (watch state) — a truthy check, not `=== undefined`.
  return { data: rows, error: error ? String(error.message) : null };
}