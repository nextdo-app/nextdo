/**
 * Reminder → system-calendar channel (issue #63) — pure, so the decision is
 * testable without an OS calendar.
 *
 * Why a second channel at all: an OS notification the app scheduled can be
 * lost when the app is force-killed or the OS reclaims a pending request on
 * aggressive ROMs. A calendar event with an alarm is owned by the system
 * calendar app, so it fires even when Nextdo never runs.
 *
 * Contract:
 *   - one reminder (a `reminders` row, i.e. one fire moment) maps to ONE
 *     event titled `action title`, running from `firesAt` to `firesAt` + the
 *     action's estimate (min 1 minute) and carrying the action's note in the
 *     description;
 *   - the alarm is 0 minutes before the start — the event's start IS the
 *     reminder moment, so the system calendar notifies at exactly `firesAt`;
 *   - a reminder that disappeared (fired, snoozed away, cleared, or whose
 *     action was completed/deleted) turns into a delete;
 *   - a changed title / time / note turns into an update, detected by the
 *     same signature the calendar-action sync uses.
 *
 * Kept separate from `reconcile.ts` (calendar actions) because the two are
 * independent sources with independent switches: turning the calendar-action
 * switch off must never withdraw the events the reminder channel owns.
 */
import type { ScheduledReminderRow } from '@nextdo/db';
import { markdownToPlainText } from '@nextdo/core';
import type { DeliveryPlatform } from '@/lib/reminders/adapters/types';
import type { ReminderDeliveryChannel } from '@/lib/notification-settings';
import type { CalendarPermission } from './device';
import { calendarEventSignature, type CalendarSyncMappings, type CalendarSyncEventSpec, type CalendarSyncPlan } from './reconcile';

/** One minute — an action with `estMinutes: 0` still needs a valid range. */
const MIN_EVENT_MS = 60_000;

/** Fallback duration when a reminder's action has no estimate. */
const DEFAULT_EVENT_MINUTES = 15;

/** The event spec for one reminder row, or null when it must not exist. */
export function reminderEventSpec(row: ScheduledReminderRow): CalendarSyncEventSpec | null {
  // An orphan (the action is gone) or an untitled row has nothing to notify
  // about — the app-side reconcile cancels its notification for the same
  // reason.
  if (row.title === null || row.title.trim() === '') return null;
  const firesAtMs = new Date(row.firesAt).getTime();
  if (!Number.isFinite(firesAtMs)) return null;
  const durationMs = Math.max(
    MIN_EVENT_MS,
    (row.estMinutes !== null && row.estMinutes > 0 ? row.estMinutes : DEFAULT_EVENT_MINUTES) *
      MIN_EVENT_MS,
  );
  // The note is authored as Markdown (task 10-22), but a calendar event
  // description is a plain-text field — the system calendar renders no
  // emphasis, so `**重要**` would show up with its asterisks. Strip the
  // markers instead of shipping them to another app.
  const plainNote = row.note === null ? '' : markdownToPlainText(row.note).trim();
  return {
    actionId: row.id,
    title: row.title,
    startsAt: new Date(firesAtMs).toISOString(),
    endsAt: new Date(firesAtMs + durationMs).toISOString(),
    notes: plainNote === '' ? undefined : plainNote,
  };
}

export interface ReminderCalendarPlanInput {
  enabled: boolean;
  rows: readonly ScheduledReminderRow[];
  mappings: CalendarSyncMappings;
  now: Date;
}

/**
 * Plan the reminder channel.
 *
 * `enabled: false` deletes everything this channel created — the caller
 * passes an empty `mappings` afterwards. Past reminders are dropped from the
 * desired set for the same reason the action sync drops ended actions: their
 * event already fired and re-creating it would notify again.
 */
export function buildReminderCalendarPlan(input: ReminderCalendarPlanInput): CalendarSyncPlan {
  const { enabled, rows, mappings, now } = input;

  if (!enabled) {
    return {
      toCreate: [],
      toUpdate: [],
      toDelete: Object.entries(mappings).map(([reminderId, mapping]) => ({
        actionId: reminderId,
        eventId: mapping.eventId,
      })),
      retained: {},
    };
  }

  const desired = new Map<string, CalendarSyncEventSpec>();
  const nowMs = now.getTime();
  for (const row of rows) {
    const spec = reminderEventSpec(row);
    if (spec === null) continue;
    if (new Date(spec.startsAt).getTime() < nowMs) continue;
    desired.set(spec.actionId, spec);
  }

  const toCreate: CalendarSyncEventSpec[] = [];
  const toUpdate: CalendarSyncPlan['toUpdate'] = [];
  const retained: CalendarSyncMappings = {};

  for (const [reminderId, spec] of desired) {
    const existing = mappings[reminderId];
    const signature = calendarEventSignature(spec);
    if (existing === undefined) {
      toCreate.push(spec);
      continue;
    }
    if (existing.signature === signature) {
      retained[reminderId] = existing;
      continue;
    }
    toUpdate.push({ ...spec, eventId: existing.eventId });
    // Retained with the OLD signature so a failed update is retried next pass.
    retained[reminderId] = existing;
  }

  const toDelete: CalendarSyncPlan['toDelete'] = [];
  for (const [reminderId, mapping] of Object.entries(mappings)) {
    if (desired.has(reminderId)) continue;
    toDelete.push({ actionId: reminderId, eventId: mapping.eventId });
  }

  return { toCreate, toUpdate, toDelete, retained };
}

/**
 * Whether the SYSTEM calendar — not the app — owns reminder delivery.
 *
 * Only an actually granted permission counts: when the user picked the
 * calendar channel but the OS denied access, no event is ever written, so
 * suppressing the app's own notification in that state would deliver
 * nothing at all. The app keeps scheduling instead, and Settings explains
 * why the calendar did not take over.
 */
export function calendarOwnsReminderDelivery(input: {
  platform: DeliveryPlatform;
  channel: ReminderDeliveryChannel;
  permission: CalendarPermission | null;
}): boolean {
  return (
    input.platform === 'native' &&
    input.channel === 'calendar' &&
    input.permission === 'granted'
  );
}
