/**
 * One action's stored reminder + the 「提醒时间」 field state built on it
 * (task 10-17). Split in two so tests can exercise the read and the field
 * rules separately:
 *
 * - `useActionReminder` — ONE read when the form opens (the form owns the
 *   value afterwards; a live query would fight the user's typing);
 * - `useActionReminderField` — the form-facing state: pre-fill from the
 *   deadline when nothing is stored, and report what to write on save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { listScheduledReminderFor, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';

import { prefillReminderValue, reminderWriteIfChanged } from '@/lib/datetime-field';

export interface ActionReminderRead {
  /** The stored moment (ISO), or null when the action has none. */
  iso: string | null;
  /** false until the read resolves — the pre-fill must wait for it. */
  loaded: boolean;
}

export function useActionReminder(actionId: string | null): ActionReminderRead {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [state, setState] = useState<ActionReminderRead>({ iso: null, loaded: false });

  useEffect(() => {
    if (actionId === null) {
      setState({ iso: null, loaded: true });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ iso: prev.iso, loaded: false }));
    // A reminder read must never block the form: any failure (including a
    // missing query in a test double) falls back to "this action has none".
    Promise.resolve()
      .then(() => listScheduledReminderFor(db, 'next', actionId))
      .then((iso) => {
        if (!cancelled) setState({ iso, loaded: true });
      })
      .catch((err: unknown) => {
        logger.warn(
          'listScheduledReminderFor failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        if (!cancelled) setState({ iso: null, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [db, actionId]);

  return state;
}

export interface ActionReminderField {
  /** The picker value; '' means "no reminder" ('' until the read lands). */
  value: string;
  setValue: (next: string) => void;
  /**
   * What the save must send: `undefined` = leave the stored reminder alone,
   * a string = arm at this moment, `null` = clear.
   */
  write: string | null | undefined;
}

/**
 * The field state one action form needs. `actionId` is null for an action
 * that does not exist yet (the add form) — then there is nothing to load and
 * the pre-fill is the whole story.
 *
 * Pre-fill lifetime: while the user has NOT touched the field, it keeps
 * following the deadline (that is the 「提醒默认跟随截止」 behaviour the
 * product asked for); the first user edit — picking a moment or clearing —
 * hands the field over to the user for good. A STORED reminder is shown as-is
 * and never re-derived from the deadline.
 */
export function useActionReminderField(args: {
  actionId: string | null;
  deadlineValue: string;
  now: Date;
}): ActionReminderField {
  const read = useActionReminder(args.actionId);
  const [value, setValue] = useState<string | null>(null);
  // Keyed by action id: the edit modal stays mounted while the user switches
  // rows, and the NEW action's reminder must load (and re-open for edits).
  const initialisedFor = useRef<string | null>(null);
  const touched = useRef(false);

  const userSetValue = useCallback((next: string) => {
    touched.current = true;
    setValue(next);
  }, []);

  useEffect(() => {
    if (!read.loaded) return;
    const key = args.actionId;
    if (initialisedFor.current !== key) {
      initialisedFor.current = key;
      touched.current = false;
      setValue(read.iso ?? prefillReminderValue(args.deadlineValue, args.now));
      return;
    }
    if (touched.current) return;
    // No stored reminder → still following the deadline.
    if (read.iso === null) setValue(prefillReminderValue(args.deadlineValue, args.now));
  }, [read, args.actionId, args.deadlineValue, args.now]);

  const current = value ?? '';
  return {
    value: current,
    setValue: userSetValue,
    write: read.loaded && value !== null ? reminderWriteIfChanged(current, read.iso) : undefined,
  };
}
