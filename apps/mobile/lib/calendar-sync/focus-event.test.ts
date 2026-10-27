/**
 * `buildFocusCalendarPlan` — the pure decision behind "write a finished focus
 * session to the system calendar". Device I/O (`expo-calendar` / EventKit) is
 * covered by manual acceptance; this suite is the unit-test subject.
 *
 * Cases:
 *   - spec: the session's own start → end, titled `正在完成【…】`, no alarm
 *     (a record of finished time must not ring);
 *   - since: sessions that ended before calendar sync was first enabled are
 *     not backfilled, but a session that was already running when the switch
 *     was flipped still gets its record;
 *   - create / retained / update / delete mirror the other two channels;
 *   - disabled: every record is withdrawn.
 */
import type { CompletedFocusSessionRow } from '@nextdo/db';
import { calendarEventSignature, type CalendarSyncMappings } from './reconcile';
import { buildFocusCalendarPlan, focusEventSpec, focusEventTitle } from './focus-event';

const SINCE = new Date('2026-10-27T00:00:00.000Z');
const MIN = 60 * 1000;

function session(
  overrides: Partial<CompletedFocusSessionRow> & { id: string },
): CompletedFocusSessionRow {
  return {
    actionKind: 'next',
    actionId: `act-${overrides.id}`,
    startedAt: new Date(SINCE.getTime() + 60 * MIN).toISOString(),
    endedAt: new Date(SINCE.getTime() + 85 * MIN).toISOString(),
    title: '写周报',
    ...overrides,
  };
}

describe('focusEventSpec', () => {
  it('spans the session itself and names the action being done', () => {
    const spec = focusEventSpec(session({ id: 'f-1' }));

    expect(spec).toEqual({
      actionId: 'f-1',
      title: '正在完成【写周报】',
      startsAt: new Date(SINCE.getTime() + 60 * MIN).toISOString(),
      endsAt: new Date(SINCE.getTime() + 85 * MIN).toISOString(),
      alarm: false,
    });
  });

  it('never sets an alarm — a finished session is a record, not a reminder', () => {
    expect(focusEventSpec(session({ id: 'f-1' }))?.alarm).toBe(false);
  });

  it('falls back to a neutral title when the action is gone', () => {
    expect(focusEventTitle(null)).toBe('专注记录');
    expect(focusEventTitle('   ')).toBe('专注记录');
    expect(focusEventSpec(session({ id: 'f-1', title: null }))?.title).toBe('专注记录');
  });

  it('keeps a sub-minute session visible instead of a zero-length event', () => {
    const spec = focusEventSpec(
      session({
        id: 'f-1',
        startedAt: new Date(SINCE.getTime() + 60 * MIN).toISOString(),
        endedAt: new Date(SINCE.getTime() + 60 * MIN + 1000).toISOString(),
      }),
    );

    expect(spec?.endsAt).toBe(new Date(SINCE.getTime() + 61 * MIN).toISOString());
  });

  it('rejects a session with unusable timestamps', () => {
    expect(focusEventSpec(session({ id: 'f-1', endedAt: 'not-a-date' }))).toBeNull();
  });
});

describe('buildFocusCalendarPlan', () => {
  it('creates an event for every session that ended after the boundary', () => {
    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [session({ id: 'f-1' }), session({ id: 'f-2' })],
      mappings: {},
      since: SINCE.toISOString(),
    });

    expect(plan.toCreate.map((spec) => spec.actionId)).toEqual(['f-1', 'f-2']);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it('does not backfill a session that ended before calendar sync was enabled', () => {
    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [
        session({
          id: 'old',
          startedAt: new Date(SINCE.getTime() - 120 * MIN).toISOString(),
          endedAt: new Date(SINCE.getTime() - 60 * MIN).toISOString(),
        }),
        session({ id: 'new' }),
      ],
      mappings: {},
      since: SINCE.toISOString(),
    });

    expect(plan.toCreate.map((spec) => spec.actionId)).toEqual(['new']);
  });

  it('records a session that was already running when the switch was flipped', () => {
    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [
        session({
          id: 'running',
          startedAt: new Date(SINCE.getTime() - 10 * MIN).toISOString(),
          endedAt: new Date(SINCE.getTime() + 15 * MIN).toISOString(),
        }),
      ],
      mappings: {},
      since: SINCE.toISOString(),
    });

    expect(plan.toCreate.map((spec) => spec.actionId)).toEqual(['running']);
  });

  it('retains an unchanged record instead of rewriting it', () => {
    const spec = focusEventSpec(session({ id: 'f-1' }));
    const mappings: CalendarSyncMappings = {
      'f-1': { eventId: 'evt-1', signature: calendarEventSignature(spec!) },
    };

    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [session({ id: 'f-1' })],
      mappings,
      since: SINCE.toISOString(),
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.retained).toEqual(mappings);
  });

  it('updates the record when the action title changed after the fact', () => {
    const stale: CalendarSyncMappings = { 'f-1': { eventId: 'evt-1', signature: 'stale' } };

    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [session({ id: 'f-1', title: '写季度总结' })],
      mappings: stale,
      since: SINCE.toISOString(),
    });

    expect(plan.toUpdate).toEqual([
      expect.objectContaining({ actionId: 'f-1', eventId: 'evt-1', title: '正在完成【写季度总结】' }),
    ]);
  });

  it('deletes the record of a session that is no longer recorded', () => {
    const plan = buildFocusCalendarPlan({
      enabled: true,
      sessions: [],
      mappings: { 'f-1': { eventId: 'evt-1', signature: 'sig' } },
      since: SINCE.toISOString(),
    });

    expect(plan.toDelete).toEqual([{ actionId: 'f-1', eventId: 'evt-1' }]);
  });

  it('withdraws every record when the channel is switched off', () => {
    const plan = buildFocusCalendarPlan({
      enabled: false,
      sessions: [session({ id: 'f-1' })],
      mappings: { 'f-1': { eventId: 'evt-1', signature: 'sig' } },
      since: SINCE.toISOString(),
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([{ actionId: 'f-1', eventId: 'evt-1' }]);
  });
});
