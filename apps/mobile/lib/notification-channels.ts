/**
 * Android notification channel ids, shared by the reminder delivery adapter
 * and the focus-timer notifications (issue #60) — one OS channel registry,
 * so a focus notification and a reminder use the same sound/silent switch.
 *
 * Importance is FIXED at first creation (Android OS: only name/description
 * are mutable afterwards), so the ids must never be renamed — that would
 * create a second channel with default importance.
 */
export const NOTIFICATION_CHANNEL_IDS = {
  normal: 'nextdo-normal',
  important: 'nextdo-important',
  alarm: 'nextdo-alarm',
  /** Issue #54: used when the user turns the reminder sound OFF. Separate
   *  from the three intensity channels because an Android channel's sound
   *  is immutable once created — silencing must pick a different channel
   *  (and one without vibration, so "silent" really is silent). */
  silent: 'nextdo-silent',
} as const;
