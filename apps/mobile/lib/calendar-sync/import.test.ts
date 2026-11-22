/**
 * Issue #100: the read-only import's busy-time rules. Pure — no OS calendar.
 *
 * The rules are the user-visible contract: all-day events must not blank out
 * a day, "free" events must not block anything, and Nextdo's own mirrored
 * events must never be imported as external busy time (a CalendarAction
 * would then conflict with itself).
 */
import {
  busyBlocksFromEvents,
  IMPORT_LOOKAHEAD_MS,
  IMPORT_LOOKBACK_MS,
  type ImportableCalendarEvent,
} from './import';
import { NEXTDO_EVENT_NOTE, nextdoEventNotes } from './reconcile';

const START = '2026-11-21T09:00:00.000Z';
const END = '2026-11-21T10:00:00.000Z';

function event(overrides: Partial<ImportableCalendarEvent> = {}): ImportableCalendarEvent {
  return {
    id: 'evt-1',
    title: '组会',
    startsAt: START,
    endsAt: END,
    allDay: false,
    availability: 'busy',
    status: 'confirmed',
    notes: null,
    ...overrides,
  };
}

describe('busyBlocksFromEvents — issue #100', () => {
  it('maps a timed busy event to one hard block', () => {
    expect(busyBlocksFromEvents([event()])).toEqual([{ start: START, end: END }]);
  });

  it('includes tentative and unavailable events, and events without availability', () => {
    const blocks = busyBlocksFromEvents([
      event({ id: 'tentative', availability: 'tentative' }),
      event({ id: 'unavailable', availability: 'unavailable' }),
      event({ id: 'unknown', availability: null }),
    ]);
    expect(blocks).toHaveLength(3);
  });

  it('skips all-day events — a holiday must not blank out the whole day', () => {
    expect(busyBlocksFromEvents([event({ allDay: true })])).toEqual([]);
  });

  it('skips free and canceled events', () => {
    expect(busyBlocksFromEvents([event({ availability: 'free' })])).toEqual([]);
    expect(busyBlocksFromEvents([event({ status: 'canceled' })])).toEqual([]);
  });

  it('skips Nextdo’s own mirrored events by id and by marker note', () => {
    const blocks = busyBlocksFromEvents(
      [
        event({ id: 'ours-by-id' }),
        event({ id: 'ours-by-note', notes: NEXTDO_EVENT_NOTE }),
      ],
      { excludeEventIds: new Set(['ours-by-id']) },
    );
    expect(blocks).toEqual([]);
  });

  it('recognises a mirror by its marker even when a user note precedes it', () => {
    // Another device wrote this event in a shared calendar; this device has no
    // local mapping for it (review R2). The note is the user's; the marker is
    // what makes the event recognisable as Nextdo's own mirror.
    const blocks = busyBlocksFromEvents([
      event({ id: 'mirror-from-other-device', notes: nextdoEventNotes('带合同，会议室 B') }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('skips unusable spans and backwards timestamps', () => {
    expect(busyBlocksFromEvents([event({ startsAt: '' })])).toEqual([]);
    expect(busyBlocksFromEvents([event({ endsAt: '' })])).toEqual([]);
    expect(
      busyBlocksFromEvents([event({ startsAt: END, endsAt: START })]),
    ).toEqual([]);
    expect(
      busyBlocksFromEvents([event({ startsAt: START, endsAt: START })]),
    ).toEqual([]);
  });

  it('sorts blocks by start so the engine input is deterministic', () => {
    const later = event({
      id: 'later',
      startsAt: '2026-11-21T15:00:00.000Z',
      endsAt: '2026-11-21T16:00:00.000Z',
    });
    const earlier = event({ id: 'earlier' });
    expect(busyBlocksFromEvents([later, earlier]).map((block) => block.start)).toEqual([
      START,
      later.startsAt,
    ]);
  });

  it('keeps the read window anchored around now', () => {
    expect(IMPORT_LOOKBACK_MS).toBe(24 * 60 * 60_000);
    expect(IMPORT_LOOKAHEAD_MS).toBe(7 * 24 * 60 * 60_000);
  });
});
