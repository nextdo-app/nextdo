/**
 * Issue #100 review R2 regression — a mirror written by ANOTHER device.
 *
 * Device A syncs a CalendarAction into a shared OS calendar with a user note.
 * Device B holds the same action (PowerSync) but has no local calendar-sync
 * mapping for that event. The import must still recognise it as Nextdo's own
 * mirror — the origin marker appended after the user note is what makes that
 * possible — otherwise the CalendarAction conflicts with itself on device B
 * forever.
 *
 * The chain is the REAL one: buildCalendarSyncPlan → device.createCalendarEvent
 * → busyBlocksFromEvents → recommend.
 */
import { recommend, type CalendarAction, type CandidateAction } from '@nextdo/core';
import { createCalendarEvent } from './device';
import { busyBlocksFromEvents, type ImportableCalendarEvent } from './import';
import { buildCalendarSyncPlan, NEXTDO_EVENT_NOTE } from './reconcile';

const NOW = new Date('2026-11-21T10:00:00.000Z');
const USER_NOTE = '带合同，会议室 B';

function calendarAction(): CalendarAction {
  return {
    id: 'ca-1',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deletedAt: null,
    title: '准备合同',
    startsAt: '2026-11-21T10:30:00.000Z',
    contextIds: [],
    estMinutes: 30,
    value: 3,
    status: 'open',
    consecutiveSkips: 0,
    note: USER_NOTE,
  } as CalendarAction;
}

function candidate(source: CalendarAction): CandidateAction {
  return {
    id: source.id,
    kind: 'calendar',
    title: source.title,
    contextIds: [],
    estMinutes: source.estMinutes,
    value: source.value,
    startsAt: source.startsAt,
    consecutiveSkips: 0,
    dependencyDone: true,
    createdAt: source.createdAt,
  };
}

describe('cross-device mirror import (issue #100 review R2)', () => {
  it('keeps the user note, appends the marker, and device B does not import the mirror', async () => {
    const created: Array<{
      id: string;
      title: string;
      notes: string;
      startDate: Date;
      endDate: Date;
    }> = [];
    const sharedCalendar = {
      id: 'cal-shared',
      createEvent: async (details: {
        title: string;
        notes: string;
        startDate: Date;
        endDate: Date;
      }) => {
        created.push({ id: 'evt-mirror', ...details });
        return { id: 'evt-mirror' };
      },
    };

    const source = calendarAction();
    // Device A: normal export with the user's note.
    const plan = buildCalendarSyncPlan({
      enabled: true,
      actions: [source],
      mappings: {},
      now: NOW,
    });
    const mapping = await createCalendarEvent(sharedCalendar as never, plan.toCreate[0]!);

    expect(mapping?.eventId).toBe('evt-mirror');
    const mirror = created[0]!;
    expect(mirror.notes).toContain(USER_NOTE);
    expect(mirror.notes).toContain(NEXTDO_EVENT_NOTE);

    // Device B: no local mapping — it only sees the shared-calendar event.
    const seenOnDeviceB: ImportableCalendarEvent = {
      id: 'evt-mirror',
      title: mirror.title,
      startsAt: mirror.startDate.toISOString(),
      endsAt: mirror.endDate.toISOString(),
      allDay: false,
      availability: 'busy',
      status: 'confirmed',
      notes: mirror.notes,
    };
    const externalBlocks = busyBlocksFromEvents([seenOnDeviceB]);
    expect(externalBlocks).toEqual([]);

    // …so the same CalendarAction is still recommendable on device B: only
    // its own block is in the calendar array, and the engine ignores it.
    const output = recommend({
      actions: [candidate(source)],
      calendar: [
        ...externalBlocks,
        {
          start: source.startsAt,
          end: '2026-11-21T11:00:00.000Z',
          sourceActionId: source.id,
        },
      ],
      projects: [],
      context: { contextIds: [], availableMinutes: 60 },
      now: NOW,
    });
    expect(output.filtered).toEqual([]);
    expect(output.recommended?.actionId).toBe(source.id);
  });
});
