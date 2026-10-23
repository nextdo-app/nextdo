/**
 * Calendar sync plan (issue #54) — pure, so the create/update/delete
 * decision is testable without an OS calendar.
 *
 * The source of truth is `calendar_actions` (a CalendarAction always has a
 * `startsAt`; its duration is `estMinutes`). Each open, not-yet-ended action
 * maps to ONE OS calendar event; the persisted mapping remembers the event id
 * and the signature of the data we last wrote, so a title/time edit turns
 * into an update and a deleted/completed action into a delete.
 *
 * The plan is deliberately absolute — it never reads a clock beyond the
 * `now` it is handed (hook-guidelines Rule 4).
 */
import { markdownToPlainText, type CalendarAction } from '@nextdo/core';

export interface CalendarSyncEventSpec {
  actionId: string;
  title: string;
  /** ISO-8601 — the event's start. */
  startsAt: string;
  /** ISO-8601 — start + `estMinutes` (min 1 minute). */
  endsAt: string;
  /** Event description. For a reminder event this carries the action's
   *  note (issue #63), so the information survives outside the app. */
  notes?: string;
}

/** What we persisted for one action after creating/updating its event. */
export interface CalendarSyncMapping {
  eventId: string;
  /** `calendarEventSignature(spec)` at write time. */
  signature: string;
}

export type CalendarSyncMappings = Record<string, CalendarSyncMapping>;

export interface CalendarSyncUpdate extends CalendarSyncEventSpec {
  eventId: string;
}

export interface CalendarSyncDelete {
  actionId: string;
  eventId: string;
}

export interface CalendarSyncPlan {
  toCreate: CalendarSyncEventSpec[];
  toUpdate: CalendarSyncUpdate[];
  toDelete: CalendarSyncDelete[];
  /**
   * Mappings that need no create/delete: unchanged ones, plus the ones whose
   * update is pending (with their OLD signature, so a failed update is
   * retried on the next pass). The caller overrides an entry after its
   * update succeeds.
   */
  retained: CalendarSyncMappings;
}

/** The persisted fingerprint of one event's user-visible content. */
export function calendarEventSignature(spec: CalendarSyncEventSpec): string {
  return [spec.title, spec.startsAt, spec.endsAt, spec.notes ?? ''].join('\u0000');
}

export interface CalendarSyncPlanInput {
  enabled: boolean;
  actions: readonly CalendarAction[];
  mappings: CalendarSyncMappings;
  now: Date;
}

/** One minute — an action with `estMinutes: 0` still needs a valid range. */
const MIN_EVENT_MS = 60_000;

export function buildCalendarSyncPlan(input: CalendarSyncPlanInput): CalendarSyncPlan {
  const { enabled, actions, mappings, now } = input;

  if (!enabled) {
    // Turning the switch off means "remove everything we created" — the
    // caller deletes these events and then persists an empty mapping.
    return {
      toCreate: [],
      toUpdate: [],
      toDelete: Object.entries(mappings).map(([actionId, mapping]) => ({
        actionId,
        eventId: mapping.eventId,
      })),
      retained: {},
    };
  }

  const desired = new Map<string, CalendarSyncEventSpec>();
  for (const action of actions) {
    if (action.deletedAt !== null || action.status !== 'open') continue;
    const startsAtMs = new Date(action.startsAt).getTime();
    if (!Number.isFinite(startsAtMs)) continue;
    const endsAtMs = startsAtMs + Math.max(action.estMinutes, 1) * MIN_EVENT_MS;
    // A finished event is neither created nor kept — a stale mapping for it
    // lands in `toDelete` below.
    if (endsAtMs < now.getTime()) continue;
    desired.set(action.id, {
      actionId: action.id,
      title: action.title,
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      // Task 10-22: the note is Markdown in the app; a calendar description
      // is plain text, so ship the markers stripped rather than showing
      // `**重要**` verbatim in another app's UI.
      notes:
        action.note === undefined || action.note === ''
          ? undefined
          : markdownToPlainText(action.note).trim() || undefined,
    });
  }

  const toCreate: CalendarSyncEventSpec[] = [];
  const toUpdate: CalendarSyncUpdate[] = [];
  const retained: CalendarSyncMappings = {};

  for (const [actionId, spec] of desired) {
    const signature = calendarEventSignature(spec);
    const existing = mappings[actionId];
    if (existing === undefined) {
      toCreate.push(spec);
      continue;
    }
    // Kept with the OLD signature: the caller's successful update replaces
    // it, so a failed one is retried on the next pass.
    retained[actionId] = existing;
    if (existing.signature !== signature) {
      toUpdate.push({ ...spec, eventId: existing.eventId });
    }
  }

  const toDelete: CalendarSyncDelete[] = [];
  for (const [actionId, mapping] of Object.entries(mappings)) {
    if (desired.has(actionId)) continue;
    toDelete.push({ actionId, eventId: mapping.eventId });
  }

  return { toCreate, toUpdate, toDelete, retained };
}
