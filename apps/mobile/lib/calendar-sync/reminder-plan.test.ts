/**
 * `buildReminderCalendarPlan` — the pure decision behind the system-calendar
 * reminder channel (issue #63). The device layer (`expo-calendar`) is a thin
 * wrapper and is covered by manual acceptance; this suite is the unit-test
 * subject.
 *
 * Cases:
 *   - create: a future reminder becomes one event titled with the action's
 *     title, spanning the estimate, carrying the note;
 *   - skip: a past reminder / an orphan / an untitled action never creates;
 *   - retained: an unchanged signature is neither created nor updated
 *     (idempotency, same rule as the calendar-action sync);
 *   - update: a changed note turns the mapping into an update and the OLD
 *     mapping is retained so a failed update retries;
 *   - delete: a reminder that disappeared deletes its event;
 *   - covered: a reminder in the minute its action event starts is left to
 *     that event (one moment must not alarm twice);
 *   - disabled: the channel is withdrawn entirely.
 */
import type { ScheduledReminderRow } from '@nextdo/db';
import type { CalendarAction } from '@nextdo/core';
import { calendarEventSignature, type CalendarSyncMappings } from './reconcile';
import {
  buildReminderCalendarPlan,
  calendarOwnsReminderDelivery,
  reminderEventSpec,
  reminderIdsCoveredByActionEvents,
} from './reminder-plan';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const MIN = 60 * 1000;

function row(overrides: Partial<ScheduledReminderRow> & { id: string }): ScheduledReminderRow {
  const { note, estMinutes, ...rest } = overrides;
  return {
    kind: 'next',
    actionId: `act-${overrides.id}`,
    firesAt: new Date(NOW.getTime() + 30 * MIN).toISOString(),
    intensity: 'normal',
    title: '默认标题',
    note: note ?? null,
    estMinutes: estMinutes ?? null,
    ...rest,
  };
}

function action(overrides: Partial<CalendarAction> & { id: string }): CalendarAction {
  return {
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deletedAt: null,
    title: '默认日程',
    startsAt: new Date(NOW.getTime() + 30 * MIN).toISOString(),
    contextIds: [],
    estMinutes: 30,
    value: 3,
    status: 'open',
    consecutiveSkips: 0,
    ...overrides,
  };
}

describe('reminderEventSpec', () => {
  it('spans the action estimate and carries the note', () => {
    const spec = reminderEventSpec(row({ id: 'r-1', note: '会议室 B', estMinutes: 40 }));

    expect(spec).toEqual({
      actionId: 'r-1',
      title: '默认标题',
      startsAt: new Date(NOW.getTime() + 30 * MIN).toISOString(),
      endsAt: new Date(NOW.getTime() + 30 * MIN + 40 * MIN).toISOString(),
      notes: '会议室 B',
    });
  });

  it('falls back to 15 minutes when the action has no estimate', () => {
    const spec = reminderEventSpec(row({ id: 'r-1' }));

    expect(spec?.endsAt).toBe(new Date(NOW.getTime() + 30 * MIN + 15 * MIN).toISOString());
  });

  it('drops the note field when the note is blank', () => {
    expect(reminderEventSpec(row({ id: 'r-1', note: '   ' }))?.notes).toBeUndefined();
  });

  it('strips Markdown markers from the description (a calendar has no emphasis)', () => {
    expect(reminderEventSpec(row({ id: 'r-1', note: '**带合同**，见 [文档](https://a.test)' }))?.notes).toBe(
      '带合同，见 文档',
    );
  });

  it('returns null for an orphan or untitled action', () => {
    expect(reminderEventSpec(row({ id: 'r-1', title: null }))).toBeNull();
    expect(reminderEventSpec(row({ id: 'r-1', title: '  ' }))).toBeNull();
  });
});

describe('buildReminderCalendarPlan', () => {
  it('creates one event per future reminder', () => {
    const rows = [row({ id: 'r-1' }), row({ id: 'r-2', firesAt: new Date(NOW.getTime() + 60 * MIN).toISOString() })];

    const plan = buildReminderCalendarPlan({ enabled: true, rows, mappings: {}, now: NOW });

    expect(plan.toCreate.map((spec) => spec.actionId)).toEqual(['r-1', 'r-2']);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it('never creates an event for a reminder that already fired', () => {
    const rows = [row({ id: 'r-1', firesAt: new Date(NOW.getTime() - MIN).toISOString() })];

    const plan = buildReminderCalendarPlan({ enabled: true, rows, mappings: {}, now: NOW });

    expect(plan.toCreate).toEqual([]);
  });

  it('retains an unchanged mapping and updates a changed one', () => {
    const unchanged = reminderEventSpec(row({ id: 'r-1' }));
    const changed = reminderEventSpec(row({ id: 'r-2', note: '新备注' }));
    // `unchanged` is non-null by construction (titled row).
    const mappings: CalendarSyncMappings = {
      'r-1': { eventId: 'e-1', signature: calendarEventSignature(unchanged!) },
      'r-2': { eventId: 'e-2', signature: '' },
    };

    const plan = buildReminderCalendarPlan({
      enabled: true,
      rows: [row({ id: 'r-1' }), row({ id: 'r-2', note: '新备注' })],
      mappings,
      now: NOW,
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.retained['r-1']).toEqual(mappings['r-1']);
    expect(plan.toUpdate).toEqual([{ ...changed, eventId: 'e-2' }]);
    // Retained with the OLD signature so a failed update retries next pass.
    expect(plan.retained['r-2']).toEqual(mappings['r-2']);
  });

  it('deletes the event of a reminder that disappeared', () => {
    const mappings: CalendarSyncMappings = { 'r-1': { eventId: 'e-1', signature: 'x' } };

    const plan = buildReminderCalendarPlan({ enabled: true, rows: [], mappings, now: NOW });

    expect(plan.toDelete).toEqual([{ actionId: 'r-1', eventId: 'e-1' }]);
  });

  it('withdraws every event when the channel is disabled', () => {
    const mappings: CalendarSyncMappings = {
      'r-1': { eventId: 'e-1', signature: 'x' },
      'r-2': { eventId: 'e-2', signature: 'y' },
    };

    const plan = buildReminderCalendarPlan({
      enabled: false,
      rows: [row({ id: 'r-1' })],
      mappings,
      now: NOW,
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.retained).toEqual({});
    expect(plan.toDelete).toEqual([
      { actionId: 'r-1', eventId: 'e-1' },
      { actionId: 'r-2', eventId: 'e-2' },
    ]);
  });

  it('never creates a covered reminder a second event', () => {
    const rows = [row({ id: 'r-1', kind: 'calendar', actionId: 'a-1' })];
    const covered = new Set(['r-1']);

    const plan = buildReminderCalendarPlan({
      enabled: true,
      rows,
      mappings: {},
      now: NOW,
      coveredReminderIds: covered,
    });

    expect(plan.toCreate).toEqual([]);
  });

  it('removes the reminder event once an action event speaks for that moment', () => {
    // One reminder used to become two events (and two alarms) for one moment:
    // the action's own event plus the reminder event at the same minute.
    const mappings: CalendarSyncMappings = { 'r-1': { eventId: 'e-1', signature: 'x' } };

    const plan = buildReminderCalendarPlan({
      enabled: true,
      rows: [row({ id: 'r-1', kind: 'calendar', actionId: 'a-1' })],
      mappings,
      now: NOW,
      coveredReminderIds: new Set(['r-1']),
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([{ actionId: 'r-1', eventId: 'e-1' }]);
  });
});

describe('reminderIdsCoveredByActionEvents', () => {
  it('covers a calendar reminder in the minute the action event starts', () => {
    const startsAt = new Date(NOW.getTime() + 30 * MIN).toISOString();
    const rows = [
      row({ id: 'r-1', kind: 'calendar', actionId: 'a-1', firesAt: startsAt }),
      // Alarms fire at minute granularity: any offset inside that minute rings
      // together with the action event.
      row({
        id: 'r-2',
        kind: 'calendar',
        actionId: 'a-1',
        firesAt: new Date(new Date(startsAt).getTime() + 59_000).toISOString(),
      }),
    ];

    const covered = reminderIdsCoveredByActionEvents(rows, [action({ id: 'a-1', startsAt })]);

    expect([...covered]).toEqual(['r-1', 'r-2']);
  });

  it('leaves a later reminder alone — it carries its own moment', () => {
    const startsAt = new Date(NOW.getTime() + 30 * MIN).toISOString();
    const rows = [
      row({
        id: 'r-1',
        kind: 'calendar',
        actionId: 'a-1',
        firesAt: new Date(new Date(startsAt).getTime() + MIN).toISOString(),
      }),
    ];

    const covered = reminderIdsCoveredByActionEvents(rows, [action({ id: 'a-1', startsAt })]);

    expect([...covered]).toEqual([]);
  });

  it('ignores reminders whose action has no calendar event, and other actions', () => {
    const startsAt = new Date(NOW.getTime() + 30 * MIN).toISOString();
    const rows = [
      // A next-action reminder never shares a moment with a calendar event.
      row({ id: 'r-1', kind: 'next', actionId: 'a-1', firesAt: startsAt }),
      row({ id: 'r-2', kind: 'calendar', actionId: 'a-2', firesAt: startsAt }),
    ];

    const covered = reminderIdsCoveredByActionEvents(rows, [action({ id: 'a-1', startsAt })]);

    expect([...covered]).toEqual([]);
  });

  it('covers nothing for a closed or deleted action — its event is gone too', () => {
    const startsAt = new Date(NOW.getTime() + 30 * MIN).toISOString();
    const rows = [row({ id: 'r-1', kind: 'calendar', actionId: 'a-1', firesAt: startsAt })];

    expect(
      reminderIdsCoveredByActionEvents(rows, [action({ id: 'a-1', startsAt, status: 'done' })]),
    ).toEqual(new Set());
    expect(
      reminderIdsCoveredByActionEvents(rows, [
        action({ id: 'a-1', startsAt, deletedAt: NOW.toISOString() }),
      ]),
    ).toEqual(new Set());
  });
});
describe('calendarOwnsReminderDelivery', () => {
  it('hands delivery to the calendar only on native, with the calendar channel, and granted access', () => {
    expect(
      calendarOwnsReminderDelivery({ platform: 'native', channel: 'calendar', permission: 'granted' }),
    ).toBe(true);
  });

  it('keeps the app in charge when access was denied, so a reminder is never silenced', () => {
    expect(
      calendarOwnsReminderDelivery({ platform: 'native', channel: 'calendar', permission: 'denied' }),
    ).toBe(false);
    expect(
      calendarOwnsReminderDelivery({
        platform: 'native',
        channel: 'calendar',
        permission: 'undetermined',
      }),
    ).toBe(false);
    expect(
      calendarOwnsReminderDelivery({ platform: 'native', channel: 'calendar', permission: null }),
    ).toBe(false);
  });

  it('never hands over on the app-only channel or on plain web', () => {
    expect(
      calendarOwnsReminderDelivery({ platform: 'native', channel: 'app', permission: 'granted' }),
    ).toBe(false);
    expect(
      calendarOwnsReminderDelivery({ platform: 'web', channel: 'calendar', permission: 'granted' }),
    ).toBe(false);
    expect(
      calendarOwnsReminderDelivery({ platform: 'tauri', channel: 'app', permission: 'granted' }),
    ).toBe(false);
  });

  it('hands delivery to the calendar on the macOS shell, which has an EventKit bridge', () => {
    expect(
      calendarOwnsReminderDelivery({ platform: 'tauri', channel: 'calendar', permission: 'granted' }),
    ).toBe(true);
  });

  it('keeps the desktop app in charge when the calendar permission is missing', () => {
    // A Windows/Linux shell has no EventKit bridge, so its permission reads
    // `denied` — the app must keep delivering rather than silence the reminder.
    expect(
      calendarOwnsReminderDelivery({ platform: 'tauri', channel: 'calendar', permission: 'denied' }),
    ).toBe(false);
    expect(
      calendarOwnsReminderDelivery({ platform: 'tauri', channel: 'calendar', permission: null }),
    ).toBe(false);
  });
});
