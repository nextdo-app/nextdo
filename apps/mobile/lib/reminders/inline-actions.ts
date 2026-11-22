/**
 * Inline notification actions (issue #99): complete / snooze / skip straight
 * from the OS notification.
 *
 * Pure module — no expo / react imports — so the action ids, the payload
 * parsing and the snooze default are unit-testable. The native adapter owns
 * category registration and the response plumbing; the delivery hook runs
 * the DB transaction (PowerSync stays the single write path).
 */
import type { ActionKind } from '@nextdo/db';
import { commonSnoozeOption } from '../snooze-options';

/**
 * The category identifier carried by every reminder notification. iOS
 * rejects `:` and `-` in category identifiers (expo-notifications docs), so
 * this stays alphanumeric + underscore.
 */
export const REMINDER_CATEGORY_ID = 'nextdo_reminder_actions';

/** Action identifiers — the values the OS sends back as `actionIdentifier`. */
export const REMINDER_ACTION_IDS = {
  complete: 'nextdo.action.complete',
  snooze: 'nextdo.action.snooze',
  skip: 'nextdo.action.skip',
} as const;

export type ReminderInlineActionKind = keyof typeof REMINDER_ACTION_IDS;

export interface ReminderInlineAction {
  kind: ReminderInlineActionKind;
  /** The action kind carried in the notification payload (`reminders.action_kind`). */
  actionKind: ActionKind;
  actionId: string;
}

/**
 * The inline 推迟 button mirrors the app's one common snooze shortcut
 * (`lib/snooze-options.ts` `commonSnoozeOption`, 10 分钟后) — the
 * notification must not invent a second default. The label is built from
 * the same number so the button copy cannot drift from the transaction.
 */
export const INLINE_SNOOZE_MINUTES = 10;

export const INLINE_SNOOZE_LABEL = `推迟 ${INLINE_SNOOZE_MINUTES} 分钟`;

export function inlineSnoozeTarget(now: Date): Date {
  return commonSnoozeOption(now).target;
}

const ACTION_KINDS: readonly ActionKind[] = ['next', 'calendar', 'habit'];

function isActionKind(value: unknown): value is ActionKind {
  return typeof value === 'string' && (ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * Parse a notification response into an inline action, or null when the
 * response is not one of ours (a plain tap, an unknown identifier, or a
 * drifted payload). The caller falls back to opening the app on null, so a
 * malformed payload never strands the user on a dead notification.
 */
export function parseInlineAction(
  actionIdentifier: string,
  data: unknown,
): ReminderInlineAction | null {
  const kind = (
    Object.keys(REMINDER_ACTION_IDS) as ReminderInlineActionKind[]
  ).find((key) => REMINDER_ACTION_IDS[key] === actionIdentifier);
  if (kind === undefined) return null;
  if (data === null || typeof data !== 'object') return null;
  const payload = data as { actionKind?: unknown; actionId?: unknown };
  if (!isActionKind(payload.actionKind)) return null;
  if (typeof payload.actionId !== 'string' || payload.actionId.length === 0) return null;
  return { kind, actionKind: payload.actionKind, actionId: payload.actionId };
}
