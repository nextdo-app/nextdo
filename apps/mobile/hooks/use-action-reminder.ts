/**
 * One action's stored reminders + the 「提醒时间」 field state built on them
 * (task 10-17, multi-select since task 10-26). Split in two so tests can
 * exercise the read and the field rules separately:
 *
 * - `useActionReminder` — ONE read when the form opens (the form owns the
 *   value afterwards; a live query would fight the user's edits);
 * - `useActionReminderField` — the form-facing state: pre-fill from the
 *   deadline when nothing is stored, and report what to write on save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listScheduledRemindersFor, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';

import {
  prefillReminderValues,
  reminderWriteIfChanged,
  type ReminderValues,
} from '@/lib/datetime-field';

export interface ActionReminderRead {
  /** The stored moments (ISO), earliest first; empty when the action has none. */
  values: ReminderValues;
  /** false until the read resolves — the pre-fill must wait for it. */
  loaded: boolean;
}

export function useActionReminder(actionId: string | null): ActionReminderRead {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [state, setState] = useState<ActionReminderRead>({ values: [], loaded: false });

  useEffect(() => {
    if (actionId === null) {
      setState({ values: [], loaded: true });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ values: prev.values, loaded: false }));
    // A reminder read must never block the form: any failure (including a
    // missing query in a test double) falls back to "this action has none".
    Promise.resolve()
      .then(() => listScheduledRemindersFor(db, 'next', actionId))
      .then((values) => {
        if (!cancelled) setState({ values, loaded: true });
      })
      .catch((err: unknown) => {
        logger.warn(
          'listScheduledRemindersFor failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        if (!cancelled) setState({ values: [], loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, actionId]);

  return state;
}

export interface ActionReminderField {
  /** The picker values, earliest first; empty means "no reminder". */
  values: ReminderValues;
  /** Replace the whole set (used by the "add a moment" picker). */
  setValues: (next: ReminderValues) => void;
  /** Append one picked moment; a duplicate is ignored. */
  addValue: (next: string) => void;
  /** Remove the moment at `index`. */
  removeValue: (index: number) => void;
  /**
   * What the save must send: `undefined` = leave the stored reminders alone,
   * a list = arm exactly those moments, `null` = clear them all.
   */
  write: ReminderValues | null | undefined;
}

/**
 * The field state one action form needs. `actionId` is null for an action
 * that does not exist yet (the add form) — then there is nothing to load and
 * the pre-fill is the whole story.
 *
 * Pre-fill lifetime: while the user has NOT touched the field, it keeps
 * following the deadline (that is the 「提醒默认跟随截止」 behaviour the
 * product asked for); the first user edit — picking a moment or clearing —
 * hands the field over to the user for good. STORED reminders are shown
 * as-is and never re-derived from the deadline.
 */
export function useActionReminderField(args: {
  actionId: string | null;
  deadlineValue: string;
  now: Date;
}): ActionReminderField {
  const read = useActionReminder(args.actionId);
  const [values, setValuesState] = useState<ReminderValues | null>(null);
  // Keyed by action id: the edit modal stays mounted while the user switches
  // rows, and the NEW action's reminders must load (and re-open for edits).
  const initialisedFor = useRef<string | null>(null);
  const touched = useRef(false);

  const setValues = useCallback((next: ReminderValues) => {
    touched.current = true;
    setValuesState(next);
  }, []);

  const addValue = useCallback((next: string) => {
    touched.current = true;
    setValuesState((prev) => {
      const current = prev ?? [];
      // The picker's resolution is the minute; picking the same moment twice
      // must not produce two identical chips.
      if (current.includes(next)) return current;
      return [...current, next].sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const removeValue = useCallback((index: number) => {
    touched.current = true;
    setValuesState((prev) => (prev ?? []).filter((_, i) => i !== index));
  }, []);

  useEffect(() => {
    if (!read.loaded) return;
    const key = args.actionId;
    if (initialisedFor.current !== key) {
      initialisedFor.current = key;
      touched.current = false;
      setValuesState(
        read.values.length > 0 ? read.values : prefillReminderValues(args.deadlineValue, args.now),
      );
      return;
    }
    if (touched.current) return;
    // Nothing stored → still following the deadline.
    if (read.values.length === 0) {
      setValuesState(prefillReminderValues(args.deadlineValue, args.now));
    }
  }, [read, args.actionId, args.deadlineValue, args.now]);

  const current = values ?? [];
  return {
    values: current,
    setValues,
    addValue,
    removeValue,
    write: read.loaded && values !== null ? reminderWriteIfChanged(current, read.values) : undefined,
  };
}
