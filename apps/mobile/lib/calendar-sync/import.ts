/**
 * Issue #100 — read-only system-calendar import (the pure part).
 *
 * The OS calendar is the user's real schedule: meetings, appointments and
 * anything else they blocked time for. The engine consumes those moments as
 * hard `CalendarBlock`s, so a CalendarAction that overlaps an external event
 * is filtered as `calendar-conflict` instead of being recommended.
 *
 * Rules (deliberately narrow for the first read-only pass):
 *   - ALL-DAY events are skipped. A birthday or holiday spans the whole day;
 *     treating it as busy would filter every fixed-time action that day.
 *   - `availability: 'free'` and canceled events are skipped — they do not
 *     occupy the user's time.
 *   - Nextdo's OWN mirrored events are skipped: importing the calendar
 *     events we wrote would make a CalendarAction conflict with itself. They
 *     are identified by the persisted event-id mappings (precise, works in a
 *     user-chosen calendar) and by the origin marker appended to EVERY event
 *     we write — including when a user note precedes it, which is what makes
 *     the rule work on another device with no local mapping (review R2).
 *     Events written before this marker existed stay unrecognised until the
 *     next sync pass updates them (the signature change forces that once).
 *   - Events with unusable timestamps or a non-positive span are skipped.
 *
 * No calendar module is touched here — `device.ts` fetches the raw events and
 * this module decides what is busy, so the rules are testable without Expo.
 */
import { toIso, type CalendarBlock } from '@nextdo/core';
import { NEXTDO_EVENT_NOTE } from './reconcile';

/** One event as the device layer reads it (plain data only). */
export interface ImportableCalendarEvent {
  id: string;
  title: string;
  /** ISO-8601; '' when the native value was unusable. */
  startsAt: string;
  /** ISO-8601; '' when the native value was unusable. */
  endsAt: string;
  allDay: boolean;
  /** Expo `Availability`: busy / free / tentative / unavailable / notSupported. */
  availability?: string | null;
  /** Expo `EventStatus`: none / confirmed / tentative / canceled. */
  status?: string | null;
  notes?: string | null;
}

export interface BusyBlockFilterOptions {
  /** Event ids Nextdo owns (the persisted calendar-sync mappings). */
  excludeEventIds?: ReadonlySet<string>;
}

/** How far back to read: catches an event already in progress. */
export const IMPORT_LOOKBACK_MS = 24 * 60 * 60_000;
/** How far ahead to read: covers today's and soon-starting CalendarActions. */
export const IMPORT_LOOKAHEAD_MS = 7 * 24 * 60 * 60_000;

/** One event → one hard block, or null when it does not occupy time. */
function busyBlock(
  event: ImportableCalendarEvent,
  excludeEventIds: ReadonlySet<string>,
): CalendarBlock | null {
  if (excludeEventIds.has(event.id)) return null;
  if (event.allDay) return null;
  if (event.availability === 'free') return null;
  if (event.status === 'canceled') return null;
  if (event.notes !== null && event.notes !== undefined && event.notes.includes(NEXTDO_EVENT_NOTE)) {
    return null;
  }
  const startMs = Date.parse(event.startsAt);
  const endMs = Date.parse(event.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { start: toIso(new Date(startMs)), end: toIso(new Date(endMs)) };
}

/**
 * The engine's external busy blocks, sorted for a deterministic input.
 * Duplicate blocks (the same event exposed by two calendars) are harmless:
 * the conflict rule only asks whether any block overlaps.
 */
export function busyBlocksFromEvents(
  events: readonly ImportableCalendarEvent[],
  options: BusyBlockFilterOptions = {},
): CalendarBlock[] {
  const excludeEventIds = options.excludeEventIds ?? new Set<string>();
  const blocks: CalendarBlock[] = [];
  for (const event of events) {
    const block = busyBlock(event, excludeEventIds);
    if (block !== null) blocks.push(block);
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return blocks;
}
