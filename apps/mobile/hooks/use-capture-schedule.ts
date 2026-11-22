/**
 * Issue #101 — the capture preview's parse/edit state.
 *
 * The parser re-runs on every keystroke (it is tiny and pure). An explicit
 * edit or "撤销解析" is keyed by the text it was made for, so continuing to
 * type naturally returns to live parsing instead of freezing stale input.
 * A completed capture resets the override: the next capture of the very same
 * text parses fresh instead of inheriting the previous dismissal.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseCaptureSchedule, type CaptureSchedule } from '@nextdo/core';

export interface UseCaptureScheduleResult {
  /** The suggestion shown in the preview; null = no usable date/time or dismissed. */
  schedule: CaptureSchedule | null;
  /** Replace the suggestion (the picker and the kind toggle call this). */
  setSchedule: (schedule: CaptureSchedule | null) => void;
  /** Discard the suggestion; the raw title is untouched. */
  clear: () => void;
  /** Forget any edit/dismissal (called after a capture is saved/closed). */
  reset: () => void;
}

export function useCaptureSchedule(text: string, now: Date): UseCaptureScheduleResult {
  const suggestion = useMemo(() => parseCaptureSchedule(text, now), [text, now]);
  const [override, setOverride] = useState<{
    text: string;
    schedule: CaptureSchedule | null;
  } | null>(null);

  // An emptied draft is a new input: deleting the text also drops an undo
  // made for the old one (retyping the same phrase then parses again).
  useEffect(() => {
    if (text === '') setOverride(null);
  }, [text]);

  const schedule = override !== null && override.text === text ? override.schedule : suggestion;
  return {
    schedule,
    setSchedule: (next) => setOverride({ text, schedule: next }),
    clear: () => setOverride({ text, schedule: null }),
    reset: () => setOverride(null),
  };
}
