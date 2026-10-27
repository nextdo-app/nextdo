/**
 * Focus session → system calendar record.
 *
 * One event per COMPLETED session, titled `正在完成【<action>】` and spanning
 * the session's own start → end, so the calendar's day view answers "what did
 * I do today" without opening the app. The event carries NO alarm — an alarm
 * on a record of finished work is noise (see `CalendarSyncEventSpec.alarm`).
 *
 * Unlike the action / reminder channels this one is append-only history, so
 * `since` bounds the backfill: it is the moment the user enabled calendar
 * sync, which keeps the switch from materializing years of old sessions. A
 * session that *ends* after that moment is always recorded, even if it started
 * before it.
 *
 * Pure — the applier lives in `use-calendar-sync` and reuses the same
 * create/update/delete plan as the other two channels.
 */
import type { CompletedFocusSessionRow } from '@nextdo/db';
import {
  calendarEventSignature,
  type CalendarSyncEventSpec,
  type CalendarSyncMappings,
  type CalendarSyncPlan,
  type CalendarSyncUpdate,
} from './reconcile';

/** One minute — a session always spans a valid, visible range. */
const MIN_EVENT_MS = 60_000;

/** The event title the user asked for: time span + the task being done. */
export function focusEventTitle(actionTitle: string | null): string {
  const title = actionTitle === null ? '' : actionTitle.trim();
  return title === '' ? '专注记录' : `正在完成【${title}】`;
}

/** One session's event spec; null when its timestamps are unusable. */
export function focusEventSpec(row: CompletedFocusSessionRow): CalendarSyncEventSpec | null {
  const startedAtMs = new Date(row.startedAt).getTime();
  const endedAtMs = new Date(row.endedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return null;
  return {
    // The mapping key is the session id, not the action id: the same action
    // can be focused many times, and each session is its own record.
    actionId: row.id,
    title: focusEventTitle(row.title),
    startsAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(Math.max(endedAtMs, startedAtMs + MIN_EVENT_MS)).toISOString(),
    alarm: false,
  };
}

export interface FocusCalendarPlanInput {
  enabled: boolean;
  sessions: readonly CompletedFocusSessionRow[];
  mappings: CalendarSyncMappings;
  /** ISO-8601 — record only sessions that ENDED at or after this moment. */
  since: string;
}

export function buildFocusCalendarPlan(input: FocusCalendarPlanInput): CalendarSyncPlan {
  const { enabled, sessions, mappings, since } = input;

  if (!enabled) {
    // Switch off: withdraw every record this channel created (the settings
    // copy promises it), and the caller resets `focusRecordSince` so turning
    // it back on starts a fresh, non-backfilled history.
    return {
      toCreate: [],
      toUpdate: [],
      toDelete: Object.entries(mappings).map(([sessionId, mapping]) => ({
        actionId: sessionId,
        eventId: mapping.eventId,
      })),
      retained: {},
    };
  }

  const sinceMs = new Date(since).getTime();
  const desired = new Map<string, CalendarSyncEventSpec>();
  for (const session of sessions) {
    const endedAtMs = new Date(session.endedAt).getTime();
    if (!Number.isFinite(endedAtMs)) continue;
    // `>=` on the END: a session that was already running when the user
    // turned the switch on still gets its record.
    if (Number.isFinite(sinceMs) && endedAtMs < sinceMs) continue;
    const spec = focusEventSpec(session);
    if (spec !== null) desired.set(session.id, spec);
  }

  const toCreate: CalendarSyncEventSpec[] = [];
  const toUpdate: CalendarSyncUpdate[] = [];
  const retained: CalendarSyncMappings = {};

  for (const [sessionId, spec] of desired) {
    const signature = calendarEventSignature(spec);
    const existing = mappings[sessionId];
    if (existing === undefined) {
      toCreate.push(spec);
      continue;
    }
    retained[sessionId] = existing;
    if (existing.signature !== signature) {
      toUpdate.push({ ...spec, eventId: existing.eventId });
    }
  }

  const toDelete = Object.entries(mappings)
    .filter(([sessionId]) => !desired.has(sessionId))
    .map(([sessionId, mapping]) => ({ actionId: sessionId, eventId: mapping.eventId }));

  return { toCreate, toUpdate, toDelete, retained };
}
