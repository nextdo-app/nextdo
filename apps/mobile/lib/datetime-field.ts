/**
 * Deadline / reminder FIELD helpers (task 10-17) — the pure rules behind the
 * forms' 「截止时间」 and 「提醒时间（可选）」 inputs. Pure on purpose: the
 * pre-fill rule and the "did the user actually change it?" rule are exactly
 * the parts that must not depend on a renderer to be testable.
 */
import { DEFAULT_DATE_ONLY_REMINDER_HHMM, isDateOnlyDeadline } from '@nextdo/core';

import { localDateTimeKey, localDateTimeToIso } from './clarify-flow';

const DATETIME_VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/;

/**
 * A picker value ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm') as the field's display
 * text — 「10月20日」 / 「10月20日 18:00」. Anything unexpected is returned
 * verbatim rather than blanked, so a bad value stays visible while it is
 * being fixed.
 */
export function formatDateTimeValue(value: string): string {
  const match = DATETIME_VALUE.exec(value);
  if (match === null) return value;
  const day = `${Number(match[2])}月${Number(match[3])}日`;
  return match[4] === undefined ? day : `${day} ${match[4]}`;
}

/**
 * What the 「提醒时间」 field pre-fills with, given the form's deadline value:
 *
 * - no deadline → nothing (the user opts in);
 * - a deadline WITH a time → that same moment;
 * - a DATE-ONLY deadline → that day at `DEFAULT_DATE_ONLY_REMINDER_HHMM`
 *   (10:00) — reminding at 23:59 is noise;
 * - a moment that already passed → nothing (a pre-filled past reminder would
 *   be silently dropped on save, which reads as a bug).
 *
 * `now` is injected (hook-guidelines Rule 4) — no hidden clock.
 */
export function prefillReminderValue(deadlineValue: string, now: Date): string {
  if (deadlineValue === '') return '';
  const deadlineIso = localDateTimeToIso(deadlineValue);
  if (deadlineIso === null) return '';
  const value = isDateOnlyDeadline(deadlineIso)
    ? `${localDateTimeKey(deadlineIso)}T${DEFAULT_DATE_ONLY_REMINDER_HHMM}`
    : localDateTimeKey(deadlineIso);
  const resolved = localDateTimeToIso(value);
  if (resolved === null) return '';
  return new Date(resolved).getTime() > now.getTime() ? value : '';
}

/** One chip's picker value, oldest first — the multi-select field's unit. */
export type ReminderValues = readonly string[];

/**
 * What the multi-select 「提醒时间」 field pre-fills with. Same single-value
 * rule as `prefillReminderValue`, wrapped as a 0-or-1 element list so the
 * field's rendering has exactly one shape.
 */
export function prefillReminderValues(deadlineValue: string, now: Date): ReminderValues {
  const single = prefillReminderValue(deadlineValue, now);
  return single === '' ? [] : [single];
}

/**
 * What a save should SEND for the reminder:
 *
 * - `undefined` → leave the stored rows alone. That is the important case:
 *   the form only owns the field the user can see, and a rename (or a
 *   deadline-only edit) must not disarm a reminder that `snoozeAction` armed;
 * - a list of ISO datetimes → (re)arm exactly those moments;
 * - `[]` → clear them.
 *
 * Comparison is at minute granularity (the picker's own resolution) and
 * order-insensitive: reordering chips or a stored moment carrying seconds
 * must not look like an edit. Malformed picks are dropped; a field whose
 * every pick is malformed reports "unchanged" rather than silently clearing
 * every stored reminder.
 */
export function reminderWriteIfChanged(
  values: ReminderValues,
  loaded: ReminderValues,
): ReminderValues | null | undefined {
  const desired = new Set<string>();
  for (const value of values) {
    const iso = localDateTimeToIso(value);
    if (iso !== null) desired.add(localDateTimeKey(iso));
  }
  const current = new Set<string>();
  for (const iso of loaded) {
    const key = localDateTimeKey(iso);
    if (key !== '') current.add(key);
  }
  if (values.length > 0 && desired.size === 0) return undefined;
  if (desired.size === current.size && [...desired].every((key) => current.has(key))) {
    return undefined;
  }
  if (desired.size === 0) return current.size === 0 ? undefined : null;
  return [...desired]
    .map((key) => localDateTimeToIso(key))
    .filter((iso): iso is string => iso !== null)
    .sort((a, b) => a.localeCompare(b));
}
