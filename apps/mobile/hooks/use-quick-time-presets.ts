/**
 * Quick time presets for the `DateTimePicker` (issue #105): the usage-ranked
 * chip list, refreshed from the device-local counter store when the modal
 * mounts. Recording is fire-and-forget — the picker closes right after
 * confirm, and the in-memory cache is already updated for the next open.
 */
import { useEffect, useRef, useState } from 'react';
import {
  buildQuickTimePresets,
  getCachedTimeUseCounts,
  readTimeUseCounts,
  recordTimeUse,
  type QuickTimePreset,
  type TimeUseCounts,
} from '@/lib/time-presets';

export interface UseQuickTimePresetsResult {
  presets: QuickTimePreset[];
  record: (hour: number, minute: number) => void;
}

/** The cache may already hold what the async read returns (a reopened modal
 *  in the same session) — skip the state write so no re-render is scheduled
 *  for identical counts. */
function sameCounts(a: TimeUseCounts, b: TimeUseCounts): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

export function useQuickTimePresets(): UseQuickTimePresetsResult {
  const [counts, setCounts] = useState<TimeUseCounts>(() => getCachedTimeUseCounts());
  const countsRef = useRef(counts);
  countsRef.current = counts;

  useEffect(() => {
    let cancelled = false;
    void readTimeUseCounts().then((loaded) => {
      // Compare BEFORE dispatching: a setState whose updater returns the same
      // value still schedules work (and trips the act warning in tests).
      if (cancelled || sameCounts(countsRef.current, loaded)) return;
      setCounts(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    presets: buildQuickTimePresets(counts),
    record: (hour, minute) => {
      void recordTimeUse(hour, minute);
    },
  };
}
